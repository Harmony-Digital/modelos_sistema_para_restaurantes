import { and, asc, count, eq, gt, gte, lt, sql } from 'drizzle-orm'
import { decryptPhone, prefilter, renderReply, type InboundItem, type ReplyKey } from '@atd/core'
import { releaseBudget, reserveBudget, schema, settleBudget, type Db } from '@atd/db'
import {
  triage, TRIAGE_BUDGET_ESTIMATE_USD, TRIAGE_PROMPT_VERSION, type JsonCallResult, type LlmClient, type Triage,
} from '@atd/ai'
import type { WhatsAppClient } from '@atd/whatsapp'
import type { Logger } from '../logger.ts'

const { aiRuns, auditLog, conversations, customers, dataSubjectRequests, messages, restaurants } = schema

export type ProcessDeps = {
  db: Db
  llm: LlmClient
  wa: Pick<WhatsAppClient, 'sendText'>
  phoneKey: Buffer
  triageModels: string[]
  log: Logger
  requeue: (conversationId: string) => Promise<unknown>
  now?: () => Date
}

export type Outcome = 'not_found' | 'nothing' | 'human_state' | 'blocked' | 'flood' | 'replied'

const FLOOD_LIMIT = 10
const PRIVACY_RENOTICE_MS = 365 * 24 * 3600_000
const MIN_OUT_OF_SCOPE_CONFIDENCE = 0.6

type AiRunRow = Omit<typeof aiRuns.$inferInsert, 'restaurantId' | 'conversationId'>

type Decision = {
  replies: ReplyKey[]
  autor: 'ia' | 'sistema'
  novoEstado?: 'aguardando_humano'
  dsr?: 'acesso' | 'exclusao'
  audit?: string
  falhas?: 'incrementar' | 'zerar'
  runs?: AiRunRow[]
}

type Ctx = {
  conv: typeof conversations.$inferSelect
  customer: typeof customers.$inferSelect
  restaurant: typeof restaurants.$inferSelect
}

export async function processConversation(deps: ProcessDeps, conversationId: string): Promise<Outcome> {
  const outcome = await decide(deps, conversationId)
  await deliver(deps, conversationId)
  if (outcome !== 'not_found') await requeueIfNewMessages(deps, conversationId)
  return outcome
}

// Mitiga a corrida de mensagem perdida: o singletonKey do pg-boss pode descartar o job
// de uma mensagem que chegou enquanto este job rodava.
async function requeueIfNewMessages(deps: ProcessDeps, conversationId: string) {
  const [fresh] = await deps.db
    .select({ id: messages.id })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(and(eq(messages.conversationId, conversationId), eq(messages.direcao, 'in'), gt(messages.id, conversations.processedUpToId)))
    .limit(1)
  if (fresh) await deps.requeue(conversationId)
}

// ---------------------------------------------------------------- decidir

async function decide(deps: ProcessDeps, conversationId: string): Promise<Outcome> {
  const { db } = deps
  const now = deps.now?.() ?? new Date()

  const [ctx] = await db
    .select({ conv: conversations, customer: customers, restaurant: restaurants })
    .from(conversations)
    .innerJoin(customers, eq(customers.id, conversations.customerId))
    .innerJoin(restaurants, eq(restaurants.id, conversations.restaurantId))
    .where(eq(conversations.id, conversationId))
  if (!ctx) return 'not_found'

  const pending = await db
    .select({ id: messages.id, tipo: messages.tipo, texto: messages.texto })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.direcao, 'in'), gt(messages.id, ctx.conv.processedUpToId)))
    .orderBy(asc(messages.id))
  if (pending.length === 0) return 'nothing'
  const upTo = pending.at(-1)!.id
  const silent: Decision = { replies: [], autor: 'sistema' }

  if (ctx.conv.estado === 'humano' || ctx.conv.estado === 'aguardando_humano') {
    await commit(db, ctx, upTo, silent, false, now)
    return 'human_state'
  }
  if (ctx.customer.bloqueadoAte && ctx.customer.bloqueadoAte > now) {
    await commit(db, ctx, upTo, silent, false, now)
    return 'blocked'
  }

  const [recent] = await db
    .select({ n: count() })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.direcao, 'in'),
        gte(messages.createdAt, sql`now() - interval '1 minute'`),
      ),
    )
  if ((recent?.n ?? 0) > FLOOD_LIMIT) {
    await db.update(customers).set({ bloqueadoAte: sql`now() + interval '5 minutes'` }).where(eq(customers.id, ctx.customer.id))
    await commit(db, ctx, upTo, { ...silent, audit: 'cliente.flood_bloqueado' }, false, now)
    deps.log.warn({ conversationId }, 'flood detectado; cliente bloqueado por 5 minutos')
    return 'flood'
  }

  const decision = await classify(deps, ctx, pending)
  const lastNotice = ctx.customer.privacyNoticeSentAt?.getTime() ?? 0
  const needsNotice = now.getTime() - lastNotice > PRIVACY_RENOTICE_MS
  if (needsNotice) decision.replies.unshift('avisoPrivacidade')
  await commit(db, ctx, upTo, decision, needsNotice, now)
  return 'replied'
}

async function classify(deps: ProcessDeps, ctx: Ctx, pending: InboundItem[]): Promise<Decision> {
  const pre = prefilter(pending)
  switch (pre.kind) {
    case 'handoff':
      return { replies: ['handoff'], autor: 'sistema', novoEstado: 'aguardando_humano', audit: 'conversa.handoff_pedido' }
    case 'lgpd':
      return { replies: ['lgpdRecebido'], autor: 'sistema', dsr: pre.tipo, audit: 'lgpd.pedido_recebido' }
    case 'canned':
      return { replies: [pre.reply], autor: 'sistema' }
    case 'unsupported_media':
      return { replies: ['midiaNaoSuportada'], autor: 'sistema' }
    case 'pass':
      return triageDecision(deps, ctx, pre.text)
  }
}

const micros = (usd: string) => Math.round(Number(usd) * 1_000_000)
const ESTIMATE_MICROS = micros(TRIAGE_BUDGET_ESTIMATE_USD)

// Custo desconhecido (null) de chamada possivelmente cobrada é contabilizado pela estimativa;
// falha pura de rede (sem status, modelo ou uso) não custa nada.
function runCostMicros(r: JsonCallResult<Triage>): number {
  if (r.usage?.costUsd != null) return micros(r.usage.costUsd)
  const maybeBilled = r.ok || r.model !== null || r.status !== null || r.usage !== null
  return maybeBilled ? ESTIMATE_MICROS : 0
}

const fmt = (m: number) => (m / 1_000_000).toFixed(6)

function toRun(r: JsonCallResult<Triage>, fallbackModel: string): AiRunRow {
  return {
    etapa: 'triagem',
    modelo: r.model ?? fallbackModel,
    promptVersion: TRIAGE_PROMPT_VERSION,
    tokensIn: r.usage?.tokensIn ?? 0,
    tokensOut: r.usage?.tokensOut ?? 0,
    tokensCache: r.usage?.tokensCache ?? 0,
    costUsd: fmt(runCostMicros(r)),
    latenciaMs: r.latencyMs,
    intent: r.ok ? r.data.intent : null,
    resultado: r.ok ? 'ok' : 'erro',
    erro: r.ok ? null : r.error,
  }
}

async function triageDecision(deps: ProcessDeps, ctx: Ctx, text: string): Promise<Decision> {
  const { db } = deps
  const reservation = await reserveBudget(db, {
    restaurantId: ctx.restaurant.id,
    scope: 'ia',
    amountUsd: TRIAGE_BUDGET_ESTIMATE_USD,
    timeZone: ctx.restaurant.timezone,
    ref: `conversa:${ctx.conv.id}`,
  })
  if (!reservation) {
    return { replies: ['modoEconomico'], autor: 'sistema', novoEstado: 'aguardando_humano', audit: 'orcamento.sem_saldo' }
  }

  const call = () => triage(deps.llm, { models: deps.triageModels, restaurante: ctx.restaurant.nome, text })
  const fallbackModel = deps.triageModels[0]!
  let result = await call()
  const runs = [toRun(result, fallbackModel)]
  if (!result.ok && result.retryable) {
    result = await call()
    runs.push(toRun(result, fallbackModel))
  }

  const spent = runs.reduce((acc, r) => acc + micros(String(r.costUsd ?? '0')), 0)
  if (spent > ESTIMATE_MICROS) deps.log.warn({ conversationId: ctx.conv.id }, 'custo real acima da estimativa')
  if (spent > 0) await settleBudget(db, reservation, fmt(spent), `conversa:${ctx.conv.id}`)
  else await releaseBudget(db, reservation, `conversa:${ctx.conv.id}`)

  if (!result.ok) {
    deps.log.error({ conversationId: ctx.conv.id, erro: result.error, status: result.status }, 'triagem falhou')
    return { replies: ['erro'], autor: 'sistema', novoEstado: 'aguardando_humano', falhas: 'incrementar', audit: 'ia.falha_triagem', runs }
  }

  const { intent, confianca } = result.data
  if (intent === 'fora_escopo' && confianca >= MIN_OUT_OF_SCOPE_CONFIDENCE) {
    return { replies: ['foraEscopo'], autor: 'ia', falhas: 'zerar', runs }
  }
  if (intent === 'humano' || intent === 'lgpd') {
    return { replies: ['handoff'], autor: 'ia', novoEstado: 'aguardando_humano', audit: 'conversa.handoff_triagem', runs }
  }
  // Etapa 01: S1–S4 ainda não implementados — substituído nas Etapas 02–05.
  return { replies: ['emBreve'], autor: 'ia', falhas: 'zerar', runs }
}

async function commit(db: Db, ctx: Ctx, upTo: number, d: Decision, noticeSent: boolean, now: Date) {
  const restaurantId = ctx.restaurant.id
  const conversationId = ctx.conv.id
  await db.transaction(async (tx) => {
    let lastRunId: number | null = null
    for (const run of d.runs ?? []) {
      const [row] = await tx.insert(aiRuns).values({ ...run, restaurantId, conversationId }).returning({ id: aiRuns.id })
      lastRunId = row!.id
    }

    for (const key of d.replies) {
      const isNotice = key === 'avisoPrivacidade'
      await tx.insert(messages).values({
        restaurantId,
        conversationId,
        direcao: 'out',
        autor: isNotice ? 'sistema' : d.autor,
        tipo: 'texto',
        texto: renderReply(key, { restaurante: ctx.restaurant.nome, politicaUrl: ctx.restaurant.politicaUrl }),
        statusEnvio: 'pendente',
        aiRunId: isNotice ? null : lastRunId,
      })
    }

    await tx
      .update(conversations)
      .set({
        processedUpToId: upTo,
        ...(d.novoEstado ? { estado: d.novoEstado } : {}),
        ...(d.falhas === 'incrementar' ? { falhasConsecutivas: sql`${conversations.falhasConsecutivas} + 1` } : {}),
        ...(d.falhas === 'zerar' ? { falhasConsecutivas: 0 } : {}),
      })
      .where(and(eq(conversations.id, conversationId), lt(conversations.processedUpToId, upTo)))

    if (noticeSent) await tx.update(customers).set({ privacyNoticeSentAt: now }).where(eq(customers.id, ctx.customer.id))
    if (d.dsr) await tx.insert(dataSubjectRequests).values({ restaurantId, customerId: ctx.customer.id, tipo: d.dsr })
    if (d.audit) {
      await tx.insert(auditLog).values({ restaurantId, atorTipo: 'ia', acao: d.audit, entidade: 'conversation', entidadeId: conversationId })
    }
  })
}

// ---------------------------------------------------------------- entregar

async function deliver(deps: ProcessDeps, conversationId: string) {
  const { db } = deps
  const pendingOut = await db
    .select({ id: messages.id, texto: messages.texto, telefoneCifrado: customers.telefoneCifrado })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .innerJoin(customers, eq(customers.id, conversations.customerId))
    .where(and(eq(messages.conversationId, conversationId), eq(messages.direcao, 'out'), eq(messages.statusEnvio, 'pendente')))
    .orderBy(asc(messages.id))
  if (pendingOut.length === 0) return

  const to = decryptPhone(pendingOut[0]!.telefoneCifrado, deps.phoneKey)
  for (const m of pendingOut) {
    const r = await deps.wa.sendText(to, m.texto ?? '')
    if (r.ok) {
      await db.update(messages).set({ wamid: r.wamid, statusEnvio: 'enviado' }).where(eq(messages.id, m.id))
    } else if (!r.retryable) {
      await db.update(messages).set({ statusEnvio: `falhou:${r.code ?? 'desconhecido'}` }).where(eq(messages.id, m.id))
      deps.log.warn({ conversationId, code: r.code }, 'envio recusado permanentemente pela Meta')
    } else {
      throw new Error(`Falha temporária ao enviar pelo WhatsApp (código ${r.code ?? 'rede'})`)
    }
  }
}
