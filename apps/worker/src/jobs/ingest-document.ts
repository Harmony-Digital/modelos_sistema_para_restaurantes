import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import {
  concluirIngestao, ERRO_RASCUNHO_INVALIDO, liberarReservasPendentes, marcarProcessando, releaseBudget, reserveBudget, schema, settleBudget, type Db,
  type Reservation,
} from '@atd/db'
import { INGESTAO_BUDGET_ESTIMATE_USD, INGESTAO_PROMPT_VERSION, lerCardapioPorIa, type JsonCallResult, type LlmClient } from '@atd/ai'
import type { RascunhoCardapio } from '@atd/core'
import type { Logger } from '../logger.ts'
import { mimeDosBytes, type Storage } from '../storage.ts'

const { aiRuns, auditLog, restaurants } = schema

export type IngestDeps = {
  db: Db
  llm: LlmClient
  storage: Pick<Storage, 'baixarObjeto'>
  /** AI_INGEST_MODELS; vazio = importação por IA desligada (só CSV) */
  ingestModels: string[] | undefined
  log: Logger
  now?: () => Date
}

export type IngestOutcome = 'ignorado' | 'rascunho' | 'erro'

/** Reserva por leitura: cobre a chamada e uma retentativa com folga (PDF grande cobra muitos tokens de entrada). */
export const INGESTAO_RESERVA_USD = '0.50'

// mensagens do painel: amigáveis, sem detalhe técnico nem conteúdo do documento
export const ERRO_SEM_MODELO = 'Importação por IA não configurada. Envie um CSV.'
export const ERRO_SEM_ORCAMENTO = 'O limite de gastos com IA foi atingido. Tente de novo depois ou envie um CSV.'
export const ERRO_STORAGE = 'Não consegui abrir o arquivo enviado. Envie de novo.'
export const ERRO_INESPERADO = 'Não foi possível ler o arquivo agora. Envie de novo.'
export const ERRO_DEMOROU = 'A leitura demorou demais. Envie de novo.'
export const ERRO_TIPO = 'O arquivo enviado não é um PDF nem uma imagem válida. Envie de novo.'
export const ERRO_CONTEUDO = 'O arquivo no armazenamento não confere com o enviado. Envie de novo.'
export const ERRO_GRANDE_DEMAIS = 'Cardápio grande demais para ler de uma vez: envie em partes (PDF menor ou fotos) ou use o CSV.'

const fmt = (m: number) => (m / 1_000_000).toFixed(6)
const micros = (usd: string) => Math.round(Number(usd) * 1_000_000)
const ESTIMATIVA_MICROS = micros(INGESTAO_BUDGET_ESTIMATE_USD)

/** Custo desconhecido de chamada possivelmente cobrada conta pela estimativa; falha sem uso (rede, 502) não custa. */
function custoMicros(r: JsonCallResult<RascunhoCardapio>): number {
  if (r.usage?.costUsd != null) return micros(r.usage.costUsd)
  return r.ok || r.usage !== null ? ESTIMATIVA_MICROS : 0
}

type Run = Omit<typeof aiRuns.$inferInsert, 'restaurantId'>

function paraRun(r: JsonCallResult<RascunhoCardapio>, modeloPadrao: string): Run {
  return {
    etapa: 'ingestao',
    modelo: r.model ?? modeloPadrao,
    promptVersion: INGESTAO_PROMPT_VERSION,
    tokensIn: r.usage?.tokensIn ?? 0,
    tokensOut: r.usage?.tokensOut ?? 0,
    tokensCache: r.usage?.tokensCache ?? 0,
    costUsd: fmt(custoMicros(r)),
    latenciaMs: r.latencyMs,
    intent: 'cardapio',
    resultado: r.ok ? 'ok' : 'erro',
    erro: r.ok ? null : r.error,
  }
}

/**
 * Job `document.ingest`: lê por IA (PDF/imagem) uma importação de cardápio `enviado` e grava um RASCUNHO para revisão
 * humana (PRD I10). Depois de marcar `processando`, nunca lança: toda falha vira `erro` com mensagem amigável (senão a
 * importação ficaria presa). Nenhuma chamada paga sem reserva de orçamento.
 */
export async function ingestDocument(deps: IngestDeps, importacaoId: string): Promise<IngestOutcome> {
  const { db } = deps
  const alvo = await marcarProcessando(db, importacaoId)
  if (!alvo) return 'ignorado'
  const ref = `importacao:${importacaoId}`
  let reserva: Reservation | null = null
  let gasto = 0
  const erro = async (mensagem: string, acao = 'cardapio.importacao_erro'): Promise<IngestOutcome> => {
    await db.transaction(async (tx) => {
      await concluirIngestao(tx, importacaoId, { ok: false, erro: mensagem })
      await tx.insert(auditLog).values({ restaurantId: alvo.restaurantId, atorTipo: 'ia', acao, entidade: 'knowledge_document', entidadeId: importacaoId })
    })
    return 'erro'
  }

  try {
    const [r] = await db.select({ timezone: restaurants.timezone }).from(restaurants).where(eq(restaurants.id, alvo.restaurantId))
    if (alvo.retomada) {
      // o processo anterior morreu no meio: devolve a reserva que ficou aberta e encerra (sem ler de novo nem cobrar)
      const n = await liberarReservasPendentes(db, { restaurantId: alvo.restaurantId, ref, timeZone: r!.timezone })
      deps.log.warn({ importacaoId, reservasLiberadas: n }, 'importação parada em processando; marcada com erro')
      return await erro(ERRO_DEMOROU)
    }
    const modelos = deps.ingestModels ?? []
    if (modelos.length === 0) return await erro(ERRO_SEM_MODELO)

    reserva = await reserveBudget(db, {
      restaurantId: alvo.restaurantId, scope: 'ia', amountUsd: INGESTAO_RESERVA_USD, timeZone: r!.timezone, ref,
      ...(deps.now ? { now: deps.now() } : {}),
    })
    if (!reserva) return await erro(ERRO_SEM_ORCAMENTO, 'orcamento.sem_saldo')

    const [bucket, ...resto] = alvo.storagePath.split('/')
    let bytes: Uint8Array
    try {
      bytes = await deps.storage.baixarObjeto(bucket!, resto.join('/'))
    } catch (err) {
      deps.log.error({ err, importacaoId }, 'falha ao baixar a importação do Storage')
      await releaseBudget(db, reserva, ref)
      reserva = null
      return await erro(ERRO_STORAGE)
    }

    // o conteúdo precisa ser do tipo gravado (o painel confere no upload; aqui é a última barreira antes da IA)
    if (mimeDosBytes(bytes) !== alvo.mime) {
      deps.log.error({ importacaoId }, 'arquivo da importação não corresponde ao tipo gravado')
      await releaseBudget(db, reserva, ref)
      reserva = null
      return await erro(ERRO_TIPO)
    }
    // o objeto tem o nome do sha256, mas quem tem acesso ao Storage poderia ter gravado outro conteúdo ali antes
    if (createHash('sha256').update(bytes).digest('hex') !== alvo.sha256) {
      deps.log.error({ importacaoId }, 'arquivo da importação não confere com o sha256 gravado')
      await releaseBudget(db, reserva, ref)
      reserva = null
      return await erro(ERRO_CONTEUDO)
    }
    const arquivo = { mime: alvo.mime, base64: Buffer.from(bytes).toString('base64'), filename: resto.at(-1) ?? 'cardapio' }
    const ler = () => lerCardapioPorIa(deps.llm, { models: modelos, arquivo })
    const runs: Run[] = []
    let resultado = await ler()
    runs.push(paraRun(resultado, modelos[0]!))
    gasto += custoMicros(resultado)
    // saída cortada (saida_truncada) não é repetível: a segunda chamada cobraria de novo e cortaria igual
    if (!resultado.ok && resultado.retryable) {
      resultado = await ler()
      runs.push(paraRun(resultado, modelos[0]!))
      gasto += custoMicros(resultado)
    }
    if (!resultado.ok) deps.log.warn({ importacaoId, erro: resultado.error, status: resultado.status }, 'leitura do cardápio pela IA falhou')
    if (gasto > micros(reserva.amountUsd)) deps.log.warn({ importacaoId }, 'custo real da importação acima da reserva')

    const final = resultado
    const reservaFinal = reserva
    let status: IngestOutcome = 'erro'
    await db.transaction(async (tx) => {
      if (gasto > 0) await settleBudget(tx, reservaFinal, fmt(gasto), ref)
      else await releaseBudget(tx, reservaFinal, ref)
      for (const run of runs) await tx.insert(aiRuns).values({ ...run, restaurantId: alvo.restaurantId })
      status = await concluirIngestao(tx, importacaoId, final.ok
        ? { ok: true, draft: final.data }
        : { ok: false, erro: final.error === 'saida_truncada' ? ERRO_GRANDE_DEMAIS : ERRO_RASCUNHO_INVALIDO })
      await tx.insert(auditLog).values({
        restaurantId: alvo.restaurantId, atorTipo: 'ia', acao: status === 'rascunho' ? 'cardapio.importacao_lida' : 'cardapio.importacao_erro',
        entidade: 'knowledge_document', entidadeId: importacaoId,
      })
    })
    reserva = null
    return status
  } catch (err) {
    deps.log.error({ err, importacaoId }, 'falha inesperada na importação do cardápio')
    if (reserva) {
      try {
        if (gasto > 0) await settleBudget(db, reserva, fmt(gasto), ref)
        else await releaseBudget(db, reserva, ref)
      } catch (e) {
        deps.log.error({ err: e, importacaoId }, 'falha ao compensar a reserva da importação')
      }
    }
    try {
      return await erro(ERRO_INESPERADO)
    } catch (e) {
      deps.log.error({ err: e, importacaoId }, 'falha ao marcar a importação com erro')
      return 'erro'
    }
  }
}
