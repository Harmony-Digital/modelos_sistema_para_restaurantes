import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, gt, inArray, like, min, ne, or, sql } from 'drizzle-orm'
import type { Db } from './client.ts'
import { ingestInbound } from './ingest.ts'
import type { Enqueue } from './queue.ts'
import { registrarAuditoria } from './painel-comum.ts'
import { assumirUsuario, withUserContext, type JwtClaims, type Tx } from './rls.ts'
import { conversations, customers, messages } from './schema/conversation.ts'
import { aiRuns } from './schema/ops.ts'

/** Não decifra: se um defeito tentar enviar pela Meta, a decifragem falha antes de qualquer chamada. */
export const TELEFONE_SIMULADO = 'simulado'
const MAX_MENSAGENS = 100
const MAX_DETALHES = 5

export type DonoSimulacao = { restaurantId: string; userId: string }
type NaConversa = DonoSimulacao & { conversationId: string }
export type MensagemSimulada = {
  id: number
  direcao: 'in' | 'out'
  tipo: 'texto' | 'audio' | 'imagem' | 'documento' | 'localizacao' | 'lista' | 'outro'
  texto: string | null
  payload: unknown
  createdAt: Date
}
export type EstadoSimulacao = {
  mensagens: MensagemSimulada[]
  /** Próximo `desdeId`: nunca passa de uma resposta ainda pendente (ela aparece quando for entregue). */
  cursor: number
  digitando: boolean
  estado: 'ia' | 'aguardando_humano' | 'humano' | 'encerrada'
  relogioOffsetSegundos: number | null
  /** a última mensagem do cliente caiu no modo econômico por falta de saldo de simulação (audit `orcamento.sem_saldo_simulacao`) */
  limiteSimulacao: boolean
}
export type DetalheExecucao = {
  id: number; etapa: 'triagem' | 'resposta' | 'stt' | 'ingestao'; modelo: string; promptVersion: string; intent: string | null
  resultado: string | null; erro: string | null; costUsd: string; latenciaMs: number | null
  /** resolução de S1: itens válidos e quantos foram respondidos com dado */
  itensValidos: number | null; itensRespondidos: number | null; createdAt: Date
}

// userId vem da sessão (uuid): não tem % nem _, então serve direto no LIKE
const prefixo = (userId: string) => `sim:${userId}:`
const doUsuario = (userId: string) => like(customers.waIdHash, `${prefixo(userId)}%`)

/** web_app ignora a RLS: o filtro por restaurante + prefixo do usuário + simulada É a autorização. */
async function conversaDoUsuario(db: Db | Tx, p: NaConversa) {
  const [c] = await db
    .select({
      id: conversations.id, waIdHash: customers.waIdHash, estado: conversations.estado,
      processedUpToId: conversations.processedUpToId, relogioOffsetSegundos: conversations.relogioOffsetSegundos,
    })
    .from(conversations)
    .innerJoin(customers, eq(customers.id, conversations.customerId))
    .where(and(
      eq(conversations.id, p.conversationId),
      eq(conversations.restaurantId, p.restaurantId),
      eq(conversations.simulada, true),
      eq(customers.simulado, true),
      doUsuario(p.userId),
    ))
  return c ?? null
}

/** Serializa abrir/novo cliente do mesmo usuário (evita duas conversas abertas por clique duplo). */
async function travar(tx: Tx, userId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${prefixo(userId)}, 0))`)
}

function abertasDoUsuario(tx: Tx, p: DonoSimulacao) {
  return tx
    .select({ id: conversations.id, relogioOffsetSegundos: conversations.relogioOffsetSegundos })
    .from(conversations)
    .innerJoin(customers, eq(customers.id, conversations.customerId))
    .where(and(
      eq(customers.restaurantId, p.restaurantId),
      eq(customers.simulado, true),
      doUsuario(p.userId),
      eq(conversations.simulada, true),
      ne(conversations.estado, 'encerrada'),
    ))
    .orderBy(desc(customers.createdAt))
}

async function criar(tx: Tx, p: DonoSimulacao, relogioOffsetSegundos: number | null) {
  const [c] = await tx
    .insert(customers)
    .values({
      restaurantId: p.restaurantId, waIdHash: `${prefixo(p.userId)}${Date.now()}`,
      telefoneCifrado: TELEFONE_SIMULADO, nomePerfil: 'Cliente simulado', simulado: true,
    })
    .returning({ id: customers.id })
  const [conv] = await tx
    .insert(conversations)
    .values({ restaurantId: p.restaurantId, customerId: c!.id, simulada: true, relogioOffsetSegundos })
    .returning({ id: conversations.id })
  return { conversationId: conv!.id }
}

/**
 * O simulador gasta IA real: com `claims`, a ação fica no `audit_log` na MESMA transação da mudança (sem texto de
 * cliente nem telefone). A mudança é feita como web_app; a auditoria passa para o usuário (RLS `self_insert`) no fim.
 * Auditoria recusada ⇒ a mudança volta.
 */
async function auditar(tx: Tx, claims: JwtClaims | undefined, p: DonoSimulacao, acao: string, conversationId: string, diff?: unknown) {
  if (!claims) return
  await assumirUsuario(tx, claims)
  await registrarAuditoria(tx, claims, { restaurantId: p.restaurantId, acao, entidade: 'conversation', entidadeId: conversationId, diff })
}

export function abrirSimulacao(db: Db, p: DonoSimulacao, claims?: JwtClaims): Promise<{ conversationId: string }> {
  return db.transaction(async (tx) => {
    await travar(tx, p.userId)
    const [atual] = await abertasDoUsuario(tx, p)
    const r = atual ? { conversationId: atual.id } : await criar(tx, p, null)
    await auditar(tx, claims, p, 'simulador.aberto', r.conversationId)
    return r
  })
}

/** Começa do zero (aviso de privacidade, pendente, histórico), mantendo o relógio simulado escolhido. */
export function novoClienteSimulado(db: Db, p: DonoSimulacao, claims?: JwtClaims): Promise<{ conversationId: string }> {
  return db.transaction(async (tx) => {
    await travar(tx, p.userId)
    const abertas = await abertasDoUsuario(tx, p)
    if (abertas.length > 0) {
      await tx.update(conversations)
        .set({ estado: 'encerrada', pendente: null })
        .where(inArray(conversations.id, abertas.map((a) => a.id)))
    }
    const r = await criar(tx, p, abertas[0]?.relogioOffsetSegundos ?? null)
    await auditar(tx, claims, p, 'simulador.novo_cliente', r.conversationId)
    return r
  })
}

export async function enviarMensagemSimulada(
  db: Db,
  p: NaConversa & { texto: string; interativoId?: string | null },
  enqueue: Enqueue,
): Promise<'ok' | 'nao_encontrada' | 'encerrada'> {
  const c = await conversaDoUsuario(db, p)
  if (!c) return 'nao_encontrada'
  if (c.estado === 'encerrada') return 'encerrada'
  await ingestInbound(db, {
    restaurantId: p.restaurantId,
    waIdHash: c.waIdHash,
    telefoneCifrado: TELEFONE_SIMULADO,
    profileName: null,
    wamid: `sim.${randomUUID()}`,
    tipo: 'texto',
    texto: p.texto,
    mediaId: null,
    timestamp: new Date(),
    interativoId: p.interativoId ?? null,
    simulado: true,
  }, enqueue)
  return 'ok'
}

export async function definirRelogioSimulado(
  db: Db,
  p: NaConversa & { offsetSegundos: number | null },
  claims?: JwtClaims,
): Promise<'ok' | 'nao_encontrada'> {
  return db.transaction(async (tx) => {
    const c = await conversaDoUsuario(tx, p)
    if (!c) return 'nao_encontrada'
    await tx.update(conversations).set({ relogioOffsetSegundos: p.offsetSegundos }).where(eq(conversations.id, c.id))
    await auditar(tx, claims, p, 'simulador.relogio', c.id, { relogioOffsetSegundos: p.offsetSegundos })
    return 'ok' as const
  })
}

export async function mensagensSimuladas(db: Db, p: NaConversa & { desdeId: number }): Promise<EstadoSimulacao | null> {
  const c = await conversaDoUsuario(db, p)
  if (!c) return null
  const doChat = eq(messages.conversationId, c.id)
  const mensagens = await db
    .select({
      id: messages.id, direcao: messages.direcao, tipo: messages.tipo, texto: messages.texto,
      payload: messages.payload, createdAt: messages.createdAt,
    })
    .from(messages)
    .where(and(doChat, gt(messages.id, p.desdeId), or(eq(messages.direcao, 'in'), eq(messages.statusEnvio, 'simulado'))))
    .orderBy(asc(messages.id))
    .limit(MAX_MENSAGENS)
  const [pend] = await db
    .select({ id: min(messages.id) })
    .from(messages)
    .where(and(doChat, eq(messages.direcao, 'out'), eq(messages.statusEnvio, 'pendente')))
  const [naoLida] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(doChat, eq(messages.direcao, 'in'), gt(messages.id, c.processedUpToId)))
    .limit(1)
  // auditoria da conversa (entidade_id = id) gravada depois da última mensagem do cliente = a resposta mais recente veio do limite
  const limite = await db.execute<{ atingido: boolean }>(
    sql`select app.simulacao_limite_atingido(${p.restaurantId}::uuid, ${c.id}::uuid) as atingido`,
  )
  const ultimo = mensagens.at(-1)?.id ?? p.desdeId
  const primeiraPendente = pend?.id ?? null
  return {
    mensagens,
    cursor: primeiraPendente === null ? ultimo : Math.min(primeiraPendente - 1, ultimo),
    digitando: c.estado === 'ia' && (!!naoLida || primeiraPendente !== null),
    estado: c.estado,
    relogioOffsetSegundos: c.relogioOffsetSegundos,
    limiteSimulacao: limite[0]?.atingido === true,
  }
}

/** Execuções da IA desta conversa simulada. A leitura de ai_runs passa pela RLS (só dono/gerente). */
export async function detalhesSimulacao(db: Db, claims: JwtClaims, p: NaConversa): Promise<DetalheExecucao[] | null> {
  const c = await conversaDoUsuario(db, p)
  if (!c) return null
  return withUserContext(db, claims, (tx) =>
    tx
      .select({
        id: aiRuns.id, etapa: aiRuns.etapa, modelo: aiRuns.modelo, promptVersion: aiRuns.promptVersion,
        intent: aiRuns.intent, resultado: aiRuns.resultado, erro: aiRuns.erro, costUsd: aiRuns.costUsd,
        latenciaMs: aiRuns.latenciaMs, itensValidos: aiRuns.itensValidos, itensRespondidos: aiRuns.itensRespondidos,
        createdAt: aiRuns.createdAt,
      })
      .from(aiRuns)
      .where(eq(aiRuns.conversationId, c.id))
      .orderBy(desc(aiRuns.id))
      .limit(MAX_DETALHES),
  )
}
