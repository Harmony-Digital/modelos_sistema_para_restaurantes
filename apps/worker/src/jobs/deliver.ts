import { createHash } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { decryptPhone } from '@atd/core'
import { arquivoAtivoPorId, guardarMidiaMeta, limparMidiaMeta, schema, type ArquivoCardapio, type Db, type Tx } from '@atd/db'
import type { SendResult, WhatsAppClient } from '@atd/whatsapp'
import type { Logger } from '../logger.ts'
import { mimeDosBytes, type Storage } from '../storage.ts'

const { conversations, customers, messages } = schema

export type DeliverDeps = {
  db: Db
  wa: Pick<WhatsAppClient, 'sendText' | 'sendLocation' | 'sendList' | 'sendDocument' | 'sendImage' | 'uploadMedia'>
  /** arquivos do cardápio (bucket privado) para subir à Meta */
  storage: Pick<Storage, 'baixarObjeto'>
  phoneKey: Buffer
  log: Logger
  now?: () => Date
}

const localizacaoPayload = z.object({ lat: z.number(), lng: z.number(), nome: z.string(), endereco: z.string() })
const listaPayload = z.object({
  botao: z.string(),
  opcoes: z.array(z.object({ id: z.string(), titulo: z.string(), descricao: z.string() })).min(1).max(10),
})
const midiaPayload = z.object({ arquivoId: z.uuid(), alternativa: z.string().min(1) })

type Pendente = {
  id: number
  restaurantId: string
  autor: string
  replyKey: string | null
  texto: string | null
  tipo: string
  payload: unknown
  customerId: string
}

/**
 * Envia as mensagens `pendente` da conversa, em ordem: respostas da IA/sistema (job da conversa) e do atendente (job
 * `conversation.deliver`). Cada mensagem é travada (`for update`) enquanto sai: dois jobs na mesma conversa nunca
 * enviam a mesma mensagem duas vezes. I5: com humano no controle, só as respostas de autor `ia` são canceladas; as do
 * sistema e do atendente seguem. Conversa simulada nunca chama a Meta (`simulado`).
 */
export async function deliver(deps: DeliverDeps, conversationId: string): Promise<void> {
  const { db } = deps
  const pendentes = await db
    .select({
      id: messages.id,
      restaurantId: messages.restaurantId,
      autor: messages.autor,
      replyKey: messages.replyKey,
      texto: messages.texto,
      tipo: messages.tipo,
      payload: messages.payload,
      telefoneCifrado: customers.telefoneCifrado,
      customerId: customers.id,
      simulada: conversations.simulada,
    })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .innerJoin(customers, eq(customers.id, conversations.customerId))
    .where(and(eq(messages.conversationId, conversationId), eq(messages.direcao, 'out'), eq(messages.statusEnvio, 'pendente')))
    .orderBy(asc(messages.id))
  if (pendentes.length === 0) return

  // canal simulador: conversa do painel nunca chama a Meta nem decifra telefone
  const simulada = pendentes[0]!.simulada
  const to = simulada ? null : decryptPhone(pendentes[0]!.telefoneCifrado, deps.phoneKey)
  for (const m of pendentes) {
    await db.transaction(async (tx) => {
      // outro job pode ter enviado (ou estar enviando) esta mensagem: espera a trava e confere de novo
      const [atual] = await tx.select({ statusEnvio: messages.statusEnvio }).from(messages).where(eq(messages.id, m.id)).for('update')
      if (atual?.statusEnvio !== 'pendente') return
      await entregarUma(deps, tx, conversationId, to, m)
    })
  }
}

/**
 * Job `conversation.deliver` (resposta do atendente). Falha temporária lança para o pg-boss tentar de novo; na última
 * tentativa, as respostas humanas ainda pendentes viram `falhou:temporaria` (o painel mostra "Não enviada" e oferece
 * "Tentar de novo") em vez de ficarem "Enviando…" para sempre na DLQ.
 */
export async function entregarRespostaHumana(
  deps: DeliverDeps,
  conversationId: string,
  opts: { ultimaTentativa: boolean },
): Promise<'entregue' | 'desistiu'> {
  try {
    await deliver(deps, conversationId)
    return 'entregue'
  } catch (err) {
    if (!opts.ultimaTentativa) throw err
    const marcadas = await deps.db.update(messages).set({ statusEnvio: 'falhou:temporaria' })
      .where(and(
        eq(messages.conversationId, conversationId), eq(messages.direcao, 'out'), eq(messages.autor, 'humano'),
        eq(messages.statusEnvio, 'pendente'),
      ))
      .returning({ id: messages.id })
    deps.log.warn({ conversationId, mensagens: marcadas.length }, 'entrega esgotou as tentativas; respostas humanas marcadas como falha')
    return 'desistiu'
  }
}

async function entregarUma(deps: DeliverDeps, tx: Tx, conversationId: string, to: string | null, m: Pendente) {
  const marcar = (statusEnvio: string) => tx.update(messages).set({ statusEnvio }).where(eq(messages.id, m.id))
  // I5: com humano no controle, respostas da IA ainda pendentes são canceladas; as do sistema e do atendente seguem
  if (m.autor === 'ia') {
    const [cur] = await tx.select({ estado: conversations.estado }).from(conversations).where(eq(conversations.id, conversationId))
    if (cur && cur.estado !== 'ia') {
      await marcar('cancelado')
      return
    }
  }
  if (to === null) {
    await marcar('simulado')
    await marcarAvisoEnviado(deps, tx, m)
    return
  }
  const entregue = m.tipo === 'documento' || m.tipo === 'imagem' ? await entregarMidia(deps, tx, to, m) : await enviarSimples(deps, to, m)
  if (entregue === 'payload_invalido') {
    await marcar('falhou:payload_invalido')
    deps.log.warn({ conversationId, messageId: m.id }, 'payload de mensagem inválido; envio descartado')
    return
  }
  const { r, alternativa } = entregue
  if (r.ok && alternativa !== null) {
    // a mídia não pôde ser entregue e o resumo saiu em texto: o registro mostra o que o cliente recebeu
    await tx.update(messages)
      .set({ tipo: 'texto', texto: alternativa, payload: null, wamid: r.wamid, statusEnvio: 'enviado' })
      .where(eq(messages.id, m.id))
  } else if (r.ok) {
    await tx.update(messages).set({ wamid: r.wamid, statusEnvio: 'enviado' }).where(eq(messages.id, m.id))
    await marcarAvisoEnviado(deps, tx, m)
  } else if (!r.retryable) {
    await marcar(`falhou:${r.code ?? 'desconhecido'}`)
    deps.log.warn({ conversationId, code: r.code }, 'envio recusado permanentemente pela Meta')
  } else {
    throw new Error(`Falha temporária ao enviar pelo WhatsApp (código ${r.code ?? 'rede'})`)
  }
}

async function marcarAvisoEnviado(deps: DeliverDeps, tx: Tx, m: { replyKey: string | null; customerId: string }) {
  if (m.replyKey !== 'avisoPrivacidade') return
  await tx.update(customers).set({ privacyNoticeSentAt: deps.now?.() ?? new Date() }).where(eq(customers.id, m.customerId))
}

async function enviarSimples(deps: DeliverDeps, to: string, m: { tipo: string; texto: string | null; payload: unknown }): Promise<Entrega | 'payload_invalido'> {
  const r = await enviar(deps, to, m)
  return r === 'payload_invalido' ? r : { r, alternativa: null }
}

function enviar(deps: DeliverDeps, to: string, m: { tipo: string; texto: string | null; payload: unknown }) {
  if (m.tipo === 'localizacao') {
    const p = localizacaoPayload.safeParse(m.payload)
    return p.success ? deps.wa.sendLocation(to, p.data) : 'payload_invalido'
  }
  if (m.tipo === 'lista') {
    const p = listaPayload.safeParse(m.payload)
    return p.success ? deps.wa.sendList(to, { corpo: m.texto ?? '', ...p.data }) : 'payload_invalido'
  }
  return deps.wa.sendText(to, m.texto ?? '')
}

// ---------------------------------------------------------------- mídia do cardápio

/** O media id da Meta vale 30 dias; guardamos com um dia de folga. */
const VALIDADE_MIDIA_MS = 29 * 86_400_000
/** Mídia recusada pela Meta (id vencido ou inválido, falha de upload/tipo): sobe o arquivo de novo uma vez. */
const MIDIA_RECUSADA = new Set([100, 131009, 131053])
const EXTENSAO: Readonly<Record<string, string>> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

/** Nome do arquivo que o cliente vê: o título, sem caracteres que quebram nomes de arquivo. */
function nomeDoArquivo(a: ArquivoCardapio): string {
  const base = a.titulo.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'cardapio'
  return `${base}.${EXTENSAO[a.mime] ?? 'pdf'}`
}

type Entrega = { r: SendResult; alternativa: string | null }

/**
 * Leituras e o cache do media id na transação da mensagem: uma conexão por entrega (o pool do worker é pequeno).
 * Envia o arquivo do cardápio: usa o media id guardado se ainda vale; senão baixa do Storage e sobe para a Meta (e
 * guarda o id). Mídia recusada: esquece o id e sobe de novo uma vez. Sem como entregar o arquivo (desativado, Storage
 * fora, Meta recusando), manda o resumo em texto (`alternativa`). Falha temporária volta para o job tentar de novo.
 */
async function entregarMidia(
  deps: DeliverDeps,
  tx: Tx,
  to: string,
  m: { id: number; tipo: string; payload: unknown; restaurantId: string },
): Promise<Entrega | 'payload_invalido'> {
  const p = midiaPayload.safeParse(m.payload)
  if (!p.success) return 'payload_invalido'
  const { arquivoId, alternativa } = p.data
  const emTexto = async (): Promise<Entrega> => ({ r: await deps.wa.sendText(to, alternativa), alternativa })
  const arquivo = await arquivoAtivoPorId(tx, { restaurantId: m.restaurantId, arquivoId })
  if (!arquivo) return emTexto()
  const agora = deps.now?.() ?? new Date()
  let mediaId = arquivo.waMediaId && arquivo.waMediaExpiresAt && arquivo.waMediaExpiresAt > agora ? arquivo.waMediaId : null
  for (let tentativa = 0; ; tentativa++) {
    if (!mediaId) {
      const up = await subirArquivo(deps, tx, arquivo, agora)
      if (up === 'sem_arquivo') return emTexto()
      if (!up.ok) {
        if (up.retryable) return { r: up, alternativa: null }
        deps.log.warn({ messageId: m.id, code: up.code }, 'Meta recusou o upload do cardápio; enviando o resumo em texto')
        return emTexto()
      }
      mediaId = up.mediaId
    }
    const r = m.tipo === 'imagem'
      ? await deps.wa.sendImage(to, { mediaId, caption: arquivo.titulo })
      : await deps.wa.sendDocument(to, { mediaId, filename: nomeDoArquivo(arquivo), caption: arquivo.titulo })
    if (r.ok || r.retryable || r.code === null || !MIDIA_RECUSADA.has(r.code)) return { r, alternativa: null }
    // o id recusado sai do cache em qualquer caso
    await limparMidiaMeta(tx, arquivo.id)
    if (tentativa >= 1) {
      deps.log.warn({ messageId: m.id, code: r.code }, 'Meta recusou a mídia do cardápio de novo; enviando o resumo em texto')
      return emTexto()
    }
    mediaId = null
  }
}

/** Baixa o arquivo do bucket privado e sobe para a Meta; guarda o media id. `sem_arquivo`: Storage não entregou. */
async function subirArquivo(deps: DeliverDeps, tx: Tx, a: ArquivoCardapio, agora: Date) {
  const [bucket, ...resto] = a.storagePath.split('/')
  let bytes: Uint8Array
  try {
    bytes = await deps.storage.baixarObjeto(bucket!, resto.join('/'))
  } catch (err) {
    deps.log.error({ err, arquivoId: a.id }, 'falha ao baixar o arquivo do cardápio do Storage')
    return 'sem_arquivo' as const
  }
  // o conteúdo precisa ser do tipo gravado (o painel confere no upload; aqui é a última barreira antes da Meta)
  if (mimeDosBytes(bytes) !== a.mime) {
    deps.log.error({ arquivoId: a.id }, 'arquivo do cardápio no Storage não corresponde ao tipo gravado')
    return 'sem_arquivo' as const
  }
  // o nome do objeto é o sha256, mas quem tem acesso ao Storage poderia ter gravado outro conteúdo ali antes
  if (createHash('sha256').update(bytes).digest('hex') !== a.sha256) {
    deps.log.error({ arquivoId: a.id }, 'arquivo do cardápio no Storage não confere com o sha256 gravado')
    return 'sem_arquivo' as const
  }
  const up = await deps.wa.uploadMedia(bytes, a.mime, nomeDoArquivo(a))
  if (up.ok) await guardarMidiaMeta(tx, { arquivoId: a.id, waMediaId: up.mediaId, expiraEm: new Date(agora.getTime() + VALIDADE_MIDIA_MS) })
  return up
}
