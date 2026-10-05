import { and, asc, count, eq, gt, gte, sql } from 'drizzle-orm'
import { decryptPhone, prefilter, renderReply, type InboundItem, type ReplyKey } from '@atd/core'
import { releaseBudget, reserveBudget, schema, settleBudget, type Db, type Reservation } from '@atd/db'
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
  budget?: { reservation: Reservation; spentMicros: number }
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
    await commit(db, ctx, upTo, silent)
    return 'human_state'
  }
  if (ctx.customer.bloqueadoAte && ctx.customer.bloqueadoAte > now) {
    await commit(db, ctx, upTo, silent)
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
    await commit(db, ctx, upTo, { ...silent, audit: 'cliente.flood_bloqueado' })
    deps.log.warn({ conversationId }, 'flood detectado; cliente bloqueado por 5 minutos')
    return 'flood'
  }

  const decision = await classify(deps, ctx, pending)
  const lastNotice = ctx.customer.privacyNoticeSentAt?.getTime() ?? 0
  const [noticePending] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.replyKey, 'avisoPrivacidade'), eq(messages.statusEnvio, 'pendente')))
    .limit(1)
  const needsNotice = !noticePending && now.getTime() - lastNotice > PRIVACY_RENOTICE_MS
  if (needsNotice) decision.replies.unshift('avisoPrivacidade')
  try {
    return await commit(db, ctx, upTo, decision)
  } catch (err) {
    // a transação desfez a liquidação: contabiliza o que já foi gasto (ou devolve a reserva)
    if (decision.budget) await compensate(deps, decision.budget.reservation, decision.budget.spentMicros, conversationId)
    throw err
  }
}

// Nunca mascara o erro original: falha da compensação é só registrada.
async function compensate(deps: ProcessDeps, reservation: Reservation, spentMicros: number, conversationId: string) {
  const ref = `conversa:${conversationId}`
  try {
    if (spentMicros > 0) await settleBudget(deps.db, reservation, fmt(spentMicros), ref)
    else await releaseBudget(deps.db, reservation, ref)
  } catch (err) {
    deps.log.error({ err, conversationId }, 'falha ao compensar a reserva de orçamento')
  }
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

const fmt = (m: number) => (m / 1_000_000).toFixed(6)
const micros = (usd: string) => Math.round(Number(usd) * 1_000_000)
const ESTIMATE_MICROS = micros(TRIAGE_BUDGET_ESTIMATE_USD)
const RESERVE_USD = fmt(2 * ESTIMATE_MICROS)

// Custo desconhecido (null) de chamada possivelmente cobrada é contabilizado pela estimativa;
// falha sem uso reportado (502, rede) não custa nada.
function runCostMicros(r: JsonCallResult<Triage>): number {
  if (r.usage?.costUsd != null) return micros(r.usage.costUsd)
  const maybeBilled = r.ok || r.usage !== null
  return maybeBilled ? ESTIMATE_MICROS : 0
}


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
    amountUsd: RESERVE_USD, // cobre a chamada e a retentativa
    timeZone: ctx.restaurant.timezone,
    ref: `conversa:${ctx.conv.id}`,
  })
  if (!reservation) {
    return { replies: ['modoEconomico'], autor: 'sistema', novoEstado: 'aguardando_humano', audit: 'orcamento.sem_saldo' }
  }

  let result: JsonCallResult<Triage>
  const runs: AiRunRow[] = []
  try {
    const call = () => triage(deps.llm, { models: deps.triageModels, restaurante: ctx.restaurant.nome, text })
    const fallbackModel = deps.triageModels[0]!
    result = await call()
    runs.push(toRun(result, fallbackModel))
    if (!result.ok && result.retryable) {
      result = await call()
      runs.push(toRun(result, fallbackModel))
    }
  } catch (err) {
    const spent = runs.reduce((acc, r) => acc + micros(String(r.costUsd ?? '0')), 0)
    await compensate(deps, reservation, spent, ctx.conv.id)
    throw err
  }

  const spentMicros = runs.reduce((acc, r) => acc + micros(String(r.costUsd ?? '0')), 0)
  if (spentMicros > micros(reservation.amountUsd)) deps.log.warn({ conversationId: ctx.conv.id }, 'custo real acima da estimativa')
  const budget = { reservation, spentMicros }

  if (!result.ok) {
    deps.log.error({ conversationId: ctx.conv.id, erro: result.error, status: result.status }, 'triagem falhou')
    return { replies: ['erro'], autor: 'sistema', novoEstado: 'aguardando_humano', falhas: 'incrementar', audit: 'ia.falha_triagem', runs, budget }
  }

  const { intent, confianca } = result.data
  if (intent === 'fora_escopo' && confianca >= MIN_OUT_OF_SCOPE_CONFIDENCE) {
    return { replies: ['foraEscopo'], autor: 'ia', falhas: 'zerar', runs, budget }
  }
  if (intent === 'humano' || intent === 'lgpd') {
    return { replies: ['handoff'], autor: 'ia', novoEstado: 'aguardando_humano', audit: 'conversa.handoff_triagem', runs, budget }
  }
  // Etapa 01: S1–S4 ainda não implementados — substituído nas Etapas 02–05.
  return { replies: ['emBreve'], autor: 'ia', falhas: 'zerar', runs, budget }
}

async function commit(db: Db, ctx: Ctx, upTo: number, d: Decision): Promise<Outcome> {
  const restaurantId = ctx.restaurant.id
  const conversationId = ctx.conv.id
  return db.transaction(async (tx): Promise<Outcome> => {
    // trava a conversa: serializa jobs concorrentes e a tomada humana (I5)
    const [cur] = await tx
      .select({ estado: conversations.estado, processedUpToId: conversations.processedUpToId })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .for('update')
    const alreadyDone = !cur || cur.processedUpToId >= upTo
    const humanOwns = !!cur && cur.estado !== 'ia'

    let lastRunId: number | null = null
    for (const run of d.runs ?? []) {
      const [row] = await tx.insert(aiRuns).values({ ...run, restaurantId, conversationId }).returning({ id: aiRuns.id })
      lastRunId = row!.id
    }
    if (d.budget) {
      const ref = `conversa:${conversationId}`
      if (d.budget.spentMicros > 0) await settleBudget(tx, d.budget.reservation, fmt(d.budget.spentMicros), ref)
      else await releaseBudget(tx, d.budget.reservation, ref)
    }
    if (alreadyDone) return 'nothing'
    if (humanOwns) {
      await tx.update(conversations).set({ processedUpToId: upTo }).where(eq(conversations.id, conversationId))
      return 'human_state'
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
        replyKey: key,
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
      .where(eq(conversations.id, conversationId))

    if (d.dsr) await tx.insert(dataSubjectRequests).values({ restaurantId, customerId: ctx.customer.id, tipo: d.dsr })
    if (d.audit) {
      await tx.insert(auditLog).values({ restaurantId, atorTipo: d.autor, acao: d.audit, entidade: 'conversation', entidadeId: conversationId })
    }
    return d.replies.length > 0 ? 'replied' : 'nothing'
  })
}

// ---------------------------------------------------------------- entregar

async function deliver(deps: ProcessDeps, conversationId: string) {
  const { db } = deps
  const pendingOut = await db
    .select({
      id: messages.id,
      autor: messages.autor,
      replyKey: messages.replyKey,
      texto: messages.texto,
      telefoneCifrado: customers.telefoneCifrado,
      customerId: customers.id,
      estado: conversations.estado,
    })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .innerJoin(customers, eq(customers.id, conversations.customerId))
    .where(and(eq(messages.conversationId, conversationId), eq(messages.direcao, 'out'), eq(messages.statusEnvio, 'pendente')))
    .orderBy(asc(messages.id))
  if (pendingOut.length === 0) return

  const to = decryptPhone(pendingOut[0]!.telefoneCifrado, deps.phoneKey)
  for (const m of pendingOut) {
    // I5: com humano no controle, respostas da IA ainda pendentes são canceladas; as do sistema seguem
    if (m.autor === 'ia') {
      const [cur] = await db.select({ estado: conversations.estado }).from(conversations).where(eq(conversations.id, conversationId))
      if (cur && cur.estado !== 'ia') {
        await db.update(messages).set({ statusEnvio: 'cancelado' }).where(eq(messages.id, m.id))
        continue
      }
    }
    const r = await deps.wa.sendText(to, m.texto ?? '')
    if (r.ok) {
      await db.update(messages).set({ wamid: r.wamid, statusEnvio: 'enviado' }).where(eq(messages.id, m.id))
      if (m.replyKey === 'avisoPrivacidade') {
        await db.update(customers).set({ privacyNoticeSentAt: deps.now?.() ?? new Date() }).where(eq(customers.id, m.customerId))
      }
    } else if (!r.retryable) {
      await db.update(messages).set({ statusEnvio: `falhou:${r.code ?? 'desconhecido'}` }).where(eq(messages.id, m.id))
      deps.log.warn({ conversationId, code: r.code }, 'envio recusado permanentemente pela Meta')
    } else {
      throw new Error(`Falha temporária ao enviar pelo WhatsApp (código ${r.code ?? 'rede'})`)
    }
  }
}
