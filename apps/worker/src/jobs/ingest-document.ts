import { createHash } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import {
  concluirIngestao, ERRO_RASCUNHO_INVALIDO, liberarReservasPendentes, marcarProcessando, proximoLote, releaseBudget, reserveBudget,
  salvarLote, schema, settleBudget, validarRascunho, type ArquivoImportacao, type Db, type EstadoLote, type Reservation,
} from '@atd/db'
import {
  INGESTAO_BUDGET_ESTIMATE_USD, INGESTAO_PROMPT_VERSION, lerCardapioPorIa, lerDocumentoPorIa, versaoPromptIngestao, type ConteudoUsuario,
  type JsonCallResult, type LeituraDocumento, type LlmClient,
} from '@atd/ai'
import {
  juntarCardapio, juntarEspacos, juntarHorarios, juntarInformacoes, juntarSoPrecos, type RascunhoCardapioImportacao, type RascunhoEspacos,
  type RascunhoHorarios, type RascunhoInformacoes, type RascunhoSoPrecos,
} from '@atd/core/importacao'
import type { Logger } from '../logger.ts'
import { contarPaginas, dividirLote, montarLote, planejarLotes, type Lote } from '../lotes.ts'
import { mimeDosBytes, type Storage } from '../storage.ts'

const { aiRuns, auditLog, knowledgeDocumentFiles, knowledgeDocuments, restaurants } = schema

export type IngestDeps = {
  db: Db
  llm: LlmClient
  storage: Pick<Storage, 'baixarObjeto'>
  /** AI_INGEST_MODELS; vazio = importação por IA desligada (só CSV) */
  ingestModels: string[] | undefined
  log: Logger
  /**
   * Enfileira o passo seguinte de uma importação em lotes (`singletonKey` = `importacaoId:passo`). Chamado depois do
   * commit; se lançar, o job lança (o pg-boss repete e a repetição segue de `lote_atual`).
   */
  reenfileirar: (importacaoId: string, passo: string) => Promise<unknown>
  now?: () => Date
}

/** `lote`: um passo da importação em lotes foi salvo e o seguinte, enfileirado. */
export type IngestOutcome = 'ignorado' | 'rascunho' | 'erro' | 'lote'

/** Reserva por leitura (ou por lote): cobre a chamada e uma retentativa com folga (PDF grande cobra muitos tokens de entrada). */
export const INGESTAO_RESERVA_USD = '0.50'
/** Teto de lotes por importação (200 páginas de PDF): cada lote é um job de até 300 s e uma reserva própria. */
export const MAX_LOTES_IMPORTACAO = 40

// mensagens do painel: amigáveis, sem detalhe técnico nem conteúdo do documento
export const ERRO_SEM_MODELO = 'Importação por IA não configurada. Envie um CSV.'
export const ERRO_SEM_ORCAMENTO = 'O limite de gastos com IA foi atingido. Tente de novo depois ou envie um CSV.'
export const ERRO_STORAGE = 'Não consegui abrir o arquivo enviado. Envie de novo.'
export const ERRO_INESPERADO = 'Não foi possível ler o arquivo agora. Envie de novo.'
export const ERRO_DEMOROU = 'A leitura demorou demais. Envie de novo.'
export const ERRO_TIPO = 'O arquivo enviado não é um PDF nem uma imagem válida. Envie de novo.'
export const ERRO_CONTEUDO = 'O arquivo no armazenamento não confere com o enviado. Envie de novo.'
export const ERRO_GRANDE_DEMAIS = 'Cardápio grande demais para ler de uma vez: envie em partes (PDF menor ou fotos) ou use o CSV.'
export const ERRO_PDF = 'Não consegui abrir um dos PDFs enviados. Envie de novo ou use fotos.'
export const ERRO_LOTE_GRANDE_DEMAIS = 'Uma parte dos arquivos é grande demais para ler de uma vez: envie fotos ou PDFs com menos conteúdo por página.'
export const ERRO_LOTES_DEMAIS = `Arquivos grandes demais: envie até ${MAX_LOTES_IMPORTACAO * 5} páginas por importação.`

const fmt = (m: number) => (m / 1_000_000).toFixed(6)
const micros = (usd: string) => Math.round(Number(usd) * 1_000_000)
const ESTIMATIVA_MICROS = micros(INGESTAO_BUDGET_ESTIMATE_USD)

/** Custo desconhecido de chamada possivelmente cobrada conta pela estimativa; falha sem uso (rede, 502) não custa. */
function custoMicros(r: JsonCallResult<unknown>): number {
  if (r.usage?.costUsd != null) return micros(r.usage.costUsd)
  return r.ok || r.usage !== null ? ESTIMATIVA_MICROS : 0
}

type Run = Omit<typeof aiRuns.$inferInsert, 'restaurantId'>

function paraRun(r: JsonCallResult<unknown>, modeloPadrao: string, promptVersion = INGESTAO_PROMPT_VERSION, intent = 'cardapio'): Run {
  return {
    etapa: 'ingestao',
    modelo: r.model ?? modeloPadrao,
    promptVersion,
    tokensIn: r.usage?.tokensIn ?? 0,
    tokensOut: r.usage?.tokensOut ?? 0,
    tokensCache: r.usage?.tokensCache ?? 0,
    costUsd: fmt(custoMicros(r)),
    latenciaMs: r.latencyMs,
    intent,
    resultado: r.ok ? 'ok' : 'erro',
    erro: r.ok ? null : r.error,
  }
}

/**
 * Job `document.ingest`: lê por IA (PDF/imagem) uma importação e grava um RASCUNHO para revisão humana (PRD I10).
 * Depois de marcar `processando`, nunca lança (salvo a falha ao reenfileirar o passo seguinte, que o pg-boss repete):
 * toda falha vira `erro` com mensagem amigável (senão a importação ficaria presa). Nenhuma chamada paga sem reserva.
 */
export async function ingestDocument(deps: IngestDeps, importacaoId: string): Promise<IngestOutcome> {
  // vários arquivos (Etapa 07): um lote por execução; arquivo único (Etapa 05): leitura inteira
  const estado = await proximoLote(deps.db, importacaoId)
  if (estado) return lerLote(deps, importacaoId, estado)
  return lerArquivoUnico(deps, importacaoId)
}

/** Importação de cardápio da Etapa 05 (um arquivo na linha principal): uma leitura inteira por job. */
async function lerArquivoUnico(deps: IngestDeps, importacaoId: string): Promise<IngestOutcome> {
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
      aoFalharAlerta: (err) => deps.log.error({ err, importacaoId }, 'falha ao gravar o alerta de gasto da recusa'),
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

// ============ importação em lotes (Etapa 07) ============

/**
 * `draft_parcial` da importação em lotes: o rascunho juntado dos lotes já lidos e, quando a saída de um lote foi
 * cortada, a metade dele que falta ler (0 ou 1; null = lote inteiro). Só o worker lê.
 */
type ParcialLotes = { rascunho: unknown; metade: 0 | 1 | null }

function lerParcial(v: unknown): ParcialLotes {
  if (v === null || typeof v !== 'object') return { rascunho: null, metade: null }
  const p = v as Partial<ParcialLotes>
  return { rascunho: p.rascunho ?? null, metade: p.metade === 0 || p.metade === 1 ? p.metade : null }
}

/** Junta a leitura do lote ao que já foi lido (`@atd/core/importacao`); parcial fora do schema do alvo lança. */
function juntar(acumulado: unknown, leitura: LeituraDocumento): unknown {
  const anterior = acumulado === null ? null : validarRascunho(leitura.alvo, leitura.modo, acumulado)
  if (acumulado !== null && !anterior) throw new Error('rascunho parcial fora do schema do alvo')
  const a = anterior?.draft ?? null
  switch (leitura.alvo) {
    case 'cardapio':
      return leitura.modo === 'so_precos'
        ? juntarSoPrecos(a as RascunhoSoPrecos | null, leitura.rascunho)
        : juntarCardapio(a as RascunhoCardapioImportacao | null, leitura.rascunho)
    case 'informacoes': return juntarInformacoes(a as RascunhoInformacoes | null, leitura.rascunho)
    case 'horarios': return juntarHorarios(a as RascunhoHorarios | null, leitura.rascunho)
    case 'espacos': return juntarEspacos(a as RascunhoEspacos | null, leitura.rascunho)
  }
}

/** CSV só existe para o cardápio completo: nos outros alvos a mensagem não sugere CSV. */
function mensagemDoAlvo(msg: string, e: EstadoLote): string {
  if (e.alvo === 'cardapio' && e.modo === 'completo') return msg
  return msg.replace(/ ou envie um CSV\.$/, '.').replace(/ Envie um CSV\.$/, '')
}

/** Baixa um arquivo da importação e confere tipo (magic bytes) e sha256 antes de qualquer uso; falha ⇒ mensagem. */
async function baixarArquivo(deps: IngestDeps, importacaoId: string, a: ArquivoImportacao): Promise<Uint8Array | string> {
  const [bucket, ...resto] = a.storagePath.split('/')
  let bytes: Uint8Array
  try {
    bytes = await deps.storage.baixarObjeto(bucket!, resto.join('/'))
  } catch (err) {
    deps.log.error({ err, importacaoId, ordem: a.ordem }, 'falha ao baixar arquivo da importação do Storage')
    return ERRO_STORAGE
  }
  if (mimeDosBytes(bytes) !== a.mime) {
    deps.log.error({ importacaoId, ordem: a.ordem }, 'arquivo da importação não corresponde ao tipo gravado')
    return ERRO_TIPO
  }
  if (createHash('sha256').update(bytes).digest('hex') !== a.sha256) {
    deps.log.error({ importacaoId, ordem: a.ordem }, 'arquivo da importação não confere com o sha256 gravado')
    return ERRO_CONTEUDO
  }
  return bytes
}

type Desfecho =
  | { tipo: 'erro'; mensagem: string }
  /** grava o parcial sem avançar o lote (divisão de um lote cortado) */
  | { tipo: 'parcial'; parcial: ParcialLotes; passo: string }
  | { tipo: 'avanca'; parcial: ParcialLotes; passo: string }
  | { tipo: 'conclui'; draft: unknown }

/**
 * Um passo da importação em lotes (um por execução do job, spec Etapa 07 §3):
 * 1. se algum PDF ainda não tem a contagem de páginas, só conta (pdf-lib), grava `paginas` e `lotes_total` e
 *    reenfileira — sem IA (download e leitura não dividem o prazo do job);
 * 2. senão lê o lote `lote_atual` (ou a metade pendente dele) com reserva, `ai_runs` e liquidação próprias, junta ao
 *    parcial e salva; último lote ⇒ `concluirIngestao` (rascunho). Saída cortada ⇒ o lote é lido em duas metades,
 *    cada uma numa execução, uma vez só. Erro ⇒ `erro` amigável, mantendo o parcial e o lote em que parou.
 * Retomada (worker morreu no meio): devolve a reserva aberta e continua de `lote_atual`, sem reler nem cobrar os
 * lotes já salvos.
 */
async function lerLote(deps: IngestDeps, importacaoId: string, estado: EstadoLote): Promise<IngestOutcome> {
  const { db } = deps
  const { restaurantId } = estado
  const ref = `importacao:${importacaoId}`
  let reserva: Reservation | null = null
  let gasto = 0
  const erro = async (mensagem: string, acao = 'importacao.erro'): Promise<IngestOutcome> => {
    await db.transaction(async (tx) => {
      await concluirIngestao(tx, importacaoId, { ok: false, erro: mensagemDoAlvo(mensagem, estado), manterParcial: true })
      await tx.insert(auditLog).values({ restaurantId, atorTipo: 'ia', acao, entidade: 'knowledge_document', entidadeId: importacaoId })
    })
    return 'erro'
  }
  /** passo a enfileirar depois do commit (fora do try: a falha ao enfileirar lança para o pg-boss repetir) */
  let proximo: string | null = null
  let saida: IngestOutcome

  try {
    saida = await (async (): Promise<IngestOutcome> => {
      const [r] = await db
        .select({ timezone: restaurants.timezone, hoje: sql<string>`(now() at time zone ${restaurants.timezone})::date::text` })
        .from(restaurants)
        .where(eq(restaurants.id, restaurantId))
      if (estado.retomada) {
        // o processo anterior morreu no meio do lote: devolve a reserva aberta; os lotes salvos não são relidos
        const n = await liberarReservasPendentes(db, { restaurantId, ref, timeZone: r!.timezone })
        deps.log.warn({ importacaoId, lote: estado.loteAtual, reservasLiberadas: n }, 'importação parada em processando; retomando do lote atual')
      }
      const modelos = deps.ingestModels ?? []
      if (modelos.length === 0) return erro(ERRO_SEM_MODELO)

      // 1º passo com PDF: conta as páginas (sem IA) e planeja
      const semContagem = estado.arquivos.filter((a) => a.mime === 'application/pdf' && a.paginas === null)
      if (semContagem.length > 0) {
        const arquivos = [...estado.arquivos]
        for (const a of semContagem) {
          const bytes = await baixarArquivo(deps, importacaoId, a)
          if (typeof bytes === 'string') return erro(bytes)
          let paginas: number
          try {
            paginas = await contarPaginas(bytes)
          } catch (err) {
            deps.log.error({ err, importacaoId, ordem: a.ordem }, 'PDF da importação não abriu')
            return erro(ERRO_PDF)
          }
          if (paginas < 1 || paginas > 5000) return erro(ERRO_PDF)
          await db.update(knowledgeDocumentFiles).set({ paginas })
            .where(and(eq(knowledgeDocumentFiles.importacaoId, importacaoId), eq(knowledgeDocumentFiles.ordem, a.ordem)))
          arquivos[arquivos.indexOf(a)] = { ...a, paginas }
        }
        const lotes = planejarLotes(arquivos)
        if (lotes.length > MAX_LOTES_IMPORTACAO) return erro(ERRO_LOTES_DEMAIS)
        // grava o plano e devolve a concessão do lote (o passo seguinte lê); só quem tem o lote corrente reenfileira
        const planejado = await db.update(knowledgeDocuments).set({ lotesTotal: lotes.length, loteLendoDesde: null })
          .where(and(eq(knowledgeDocuments.id, importacaoId), eq(knowledgeDocuments.status, 'processando'), eq(knowledgeDocuments.loteAtual, estado.loteAtual)))
          .returning({ id: knowledgeDocuments.id })
        if (planejado.length > 0) proximo = String(estado.loteAtual)
        return 'lote'
      }

      const lotes = planejarLotes(estado.arquivos)
      if (lotes.length > MAX_LOTES_IMPORTACAO) return erro(ERRO_LOTES_DEMAIS)
      const parcial = lerParcial(estado.draftParcial)
      const n = estado.loteAtual
      const lote = lotes[n]
      if (!lote) {
        // todos os lotes salvos sem concluir (não deveria acontecer): conclui com o que foi lido
        let status: IngestOutcome = 'erro'
        await db.transaction(async (tx) => {
          status = await concluirIngestao(tx, importacaoId, parcial.rascunho === null ? { ok: false, erro: ERRO_RASCUNHO_INVALIDO } : { ok: true, draft: parcial.rascunho })
        })
        return status
      }
      const doLote: Lote | undefined = parcial.metade === null ? lote : dividirLote(lote)?.[parcial.metade]
      if (!doLote) throw new Error('metade pendente de um lote que não se divide')

      reserva = await reserveBudget(db, {
        restaurantId, scope: 'ia', amountUsd: INGESTAO_RESERVA_USD, timeZone: r!.timezone, ref,
        aoFalharAlerta: (err) => deps.log.error({ err, importacaoId }, 'falha ao gravar o alerta de gasto da recusa'),
        ...(deps.now ? { now: deps.now() } : {}),
      })
      if (!reserva) return erro(ERRO_SEM_ORCAMENTO, 'orcamento.sem_saldo')

      const devolver = async (mensagem: string) => {
        await releaseBudget(db, reserva!, ref)
        reserva = null
        return erro(mensagem)
      }
      const bytes = new Map<number, Uint8Array>()
      for (const ordem of new Set(doLote.partes.map((p) => p.ordem))) {
        const a = estado.arquivos.find((x) => x.ordem === ordem)!
        const b = await baixarArquivo(deps, importacaoId, a)
        if (typeof b === 'string') return devolver(b)
        bytes.set(ordem, b)
      }
      let partes: ConteudoUsuario[]
      try {
        partes = await montarLote(doLote, bytes)
      } catch (err) {
        deps.log.error({ err, importacaoId, lote: n }, 'falha ao montar o lote do PDF')
        return devolver(ERRO_PDF)
      }

      const versao = versaoPromptIngestao(estado.alvo, estado.modo)
      const ler = () => lerDocumentoPorIa(deps.llm, { alvo: estado.alvo, modo: estado.modo, partes, modelos, hoje: r!.hoje })
      const runs: Run[] = []
      let resultado = await ler()
      runs.push(paraRun(resultado, modelos[0]!, versao, estado.alvo))
      gasto += custoMicros(resultado)
      // saída cortada não é repetível (cobraria de novo e cortaria igual): vira divisão do lote
      if (!resultado.ok && resultado.retryable) {
        resultado = await ler()
        runs.push(paraRun(resultado, modelos[0]!, versao, estado.alvo))
        gasto += custoMicros(resultado)
      }
      if (!resultado.ok) deps.log.warn({ importacaoId, lote: n, erro: resultado.error, status: resultado.status }, 'leitura do lote pela IA falhou')
      if (gasto > micros(reserva.amountUsd)) deps.log.warn({ importacaoId, lote: n }, 'custo real do lote acima da reserva')

      let desfecho: Desfecho
      if (resultado.ok) {
        const juntado = juntar(parcial.rascunho, resultado.data)
        if (parcial.metade === 0) desfecho = { tipo: 'parcial', parcial: { rascunho: juntado, metade: 1 }, passo: `${n}b` }
        else if (n === lotes.length - 1) desfecho = { tipo: 'conclui', draft: juntado }
        else desfecho = { tipo: 'avanca', parcial: { rascunho: juntado, metade: null }, passo: String(n + 1) }
      } else if (resultado.error === 'saida_truncada') {
        desfecho = parcial.metade === null && dividirLote(lote)
          ? { tipo: 'parcial', parcial: { rascunho: parcial.rascunho, metade: 0 }, passo: `${n}a` }
          : { tipo: 'erro', mensagem: lotes.length === 1 && estado.alvo === 'cardapio' ? ERRO_GRANDE_DEMAIS : ERRO_LOTE_GRANDE_DEMAIS }
      } else {
        desfecho = { tipo: 'erro', mensagem: ERRO_RASCUNHO_INVALIDO }
      }

      const reservaFinal = reserva
      let status: IngestOutcome = 'erro'
      await db.transaction(async (tx) => {
        if (gasto > 0) await settleBudget(tx, reservaFinal, fmt(gasto), ref)
        else await releaseBudget(tx, reservaFinal, ref)
        for (const run of runs) await tx.insert(aiRuns).values({ ...run, restaurantId })
        switch (desfecho.tipo) {
          case 'parcial': {
            // só no lote corrente e ainda processando: quem chegar depois (reentrega) não sobrescreve nem reenfileira
            const salvos = await tx.update(knowledgeDocuments).set({ draftParcial: desfecho.parcial, lotesTotal: lotes.length, loteLendoDesde: null })
              .where(and(eq(knowledgeDocuments.id, importacaoId), eq(knowledgeDocuments.status, 'processando'), eq(knowledgeDocuments.loteAtual, n)))
              .returning({ id: knowledgeDocuments.id })
            status = 'lote'
            if (salvos.length > 0) proximo = desfecho.passo
            break
          }
          case 'avanca': {
            // false = o lote já foi salvo por outro leitor, que reenfileira
            const salvo = await salvarLote(tx, importacaoId, { lote: n, lotesTotal: lotes.length, draftParcial: desfecho.parcial })
            status = 'lote'
            if (salvo) proximo = desfecho.passo
            break
          }
          case 'conclui':
          case 'erro': {
            // só quem ainda tem o lote corrente conclui e audita (reentrega do mesmo lote não faz nada).
            // Concluído: o progresso fica "n de n" (o painel mostra o total lido)
            const doLoteCorrente = await tx.update(knowledgeDocuments)
              .set(desfecho.tipo === 'conclui' ? { loteAtual: n + 1, lotesTotal: lotes.length } : { loteLendoDesde: null })
              .where(and(eq(knowledgeDocuments.id, importacaoId), eq(knowledgeDocuments.status, 'processando'), eq(knowledgeDocuments.loteAtual, n)))
              .returning({ id: knowledgeDocuments.id })
            if (doLoteCorrente.length === 0) {
              status = 'ignorado'
              break
            }
            status = await concluirIngestao(tx, importacaoId, desfecho.tipo === 'conclui'
              ? { ok: true, draft: desfecho.draft }
              : { ok: false, erro: mensagemDoAlvo(desfecho.mensagem, estado), manterParcial: true })
            await tx.insert(auditLog).values({
              restaurantId, atorTipo: 'ia', acao: status === 'rascunho' ? 'importacao.lida' : 'importacao.erro',
              entidade: 'knowledge_document', entidadeId: importacaoId,
            })
          }
        }
      })
      reserva = null
      return status
    })()
  } catch (err) {
    deps.log.error({ err, importacaoId }, 'falha inesperada na importação em lotes')
    proximo = null
    const aberta = reserva as Reservation | null
    if (aberta) {
      try {
        if (gasto > 0) await settleBudget(db, aberta, fmt(gasto), ref)
        else await releaseBudget(db, aberta, ref)
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
  if (proximo !== null) await deps.reenfileirar(importacaoId, proximo)
  return saida
}
