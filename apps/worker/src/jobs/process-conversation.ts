import { and, asc, count, eq, gt, gte, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  agoraLocal, decryptPhone, escolhaDeUnidade, lerPessoas, MAX_PESSOAS, prefilter, redactPii, renderModelo, renderReply, resolverAtendimento,
  SERVICOS, TIPOS_S1, TIPOS_S2, TIPOS_S3,
  type AcaoS2, type InboundItem, type Lacuna, type ListaUnidades, type Localizacao, type ReplyKey,
  type ResultadoAtendimento,
} from '@atd/core'
import {
  avisosAtivosDoCliente, cancelarAvisoDoCliente, carregarContextoS1, registrarAviso, registrarLacunas, releaseBudget, reserveBudget,
  schema, settleBudget, type Db, type Reservation,
} from '@atd/db'
import {
  TRIAGE_BUDGET_ESTIMATE_USD, TRIAGE_V3_PROMPT_VERSION, triageV3, type JsonCallResult, type LlmClient, type TriageV3,
} from '@atd/ai'
import type { WhatsAppClient } from '@atd/whatsapp'
import type { Logger } from '../logger.ts'

const { aiRuns, auditLog, conversations, customers, dataSubjectRequests, messages, restaurants } = schema

export type ProcessDeps = {
  db: Db
  llm: LlmClient
  wa: Pick<WhatsAppClient, 'sendText' | 'sendLocation' | 'sendList'>
  phoneKey: Buffer
  triageModels: string[]
  log: Logger
  requeue: (conversationId: string) => Promise<unknown>
  now?: () => Date
}

export type Outcome = 'not_found' | 'nothing' | 'human_state' | 'blocked' | 'flood' | 'replied'

const FLOOD_LIMIT = 10
const PRIVACY_RENOTICE_MS = 365 * 24 * 3600_000

type AiRunRow = Omit<typeof aiRuns.$inferInsert, 'restaurantId' | 'conversationId'>

type Saida =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'localizacao'; texto: string; payload: Localizacao }
  | { tipo: 'lista'; texto: string; payload: Pick<ListaUnidades, 'botao' | 'opcoes'> }

const itemSchema = z.object({
  servico: z.enum(SERVICOS),
  tipo: z.enum([...TIPOS_S1, ...TIPOS_S2, ...TIPOS_S3]).nullable(),
  unidade: z.string().nullable(),
  data: z.string().nullable(),
  tema: z.string().nullable(),
  // avisos de presença (Etapa 03): pendentes antigos não têm os campos
  // até 1000 como na triagem v3: acima de 60 o core responde o limite (o item precisa sobreviver no pendente de unidade)
  pessoas: z.number().int().min(1).max(1000).nullable().default(null),
  horario: z.string().max(40).nullable().default(null),
  // eventos (Etapa 04): idem; o uso real (pendente pedido_evento) vem na Task 4
  convidados: z.number().nullable().default(null), // o core valida 1–1000 (o item cru espera a lista de unidade)
  tipoEvento: z.string().max(120).nullable().default(null),
  espaco: z.string().max(120).nullable().default(null),
})
// pendente antigo (sem `tipo`) é lido como 'unidade'
const pendenteUnidadeSchema = z.object({
  tipo: z.literal('unidade').default('unidade'),
  pergunta: z.string().max(300).default(''),
  itens: z.array(itemSchema).min(1).max(5),
  opcoes: z.array(z.string()).min(1).max(10),
  expiraEm: z.iso.datetime(),
})
const pendentePessoasSchema = z.object({
  tipo: z.literal('pessoas'),
  pergunta: z.string().max(300).default(''),
  item: itemSchema,
  unitId: z.string(),
  expiraEm: z.iso.datetime(),
})
const pendenteSchema = z.union([pendentePessoasSchema, pendenteUnidadeSchema])
type Pendente = z.infer<typeof pendenteSchema>
const localizacaoPayload = z.object({ lat: z.number(), lng: z.number(), nome: z.string(), endereco: z.string() })
const listaPayload = z.object({
  botao: z.string(),
  opcoes: z.array(z.object({ id: z.string(), titulo: z.string(), descricao: z.string() })).min(1).max(10),
})
const interativoSchema = z.object({ interativoId: z.string() })

const PENDENTE_MIN = 30
const MAX_PALAVRAS_ESCOLHA = 4
const MAX_PERGUNTA = 300

type Pending = InboundItem & { id: number; payload: unknown }

type Decision = {
  replies: ReplyKey[]
  autor: 'ia' | 'sistema'
  novoEstado?: 'aguardando_humano'
  dsr?: 'acesso' | 'exclusao'
  audit?: string
  falhas?: 'incrementar' | 'zerar'
  runs?: AiRunRow[]
  budget?: { reservation: Reservation; spentMicros: number }
  saidas?: Saida[]
  lacunas?: Lacuna[]
  pergunta?: string
  avisos?: AcaoS2[]
  contagem?: { validos: number; respondidos: number }
  /** undefined = não mexe; null = limpa; objeto = grava */
  pendente?: Pendente | null
}

type Ctx = {
  conv: typeof conversations.$inferSelect
  customer: typeof customers.$inferSelect
  restaurant: typeof restaurants.$inferSelect
}

/** Relógio da conversa: só o simulador pode deslocá-lo; conversa real usa sempre o relógio real. */
export function agoraDaConversa(real: Date, conv: { simulada: boolean; relogioOffsetSegundos: number | null }): Date {
  return conv.simulada && conv.relogioOffsetSegundos != null ? new Date(real.getTime() + conv.relogioOffsetSegundos * 1000) : real
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
    .select({ id: messages.id, tipo: messages.tipo, texto: messages.texto, payload: messages.payload })
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

  // relógio simulado vale para S1 e pendente; bloqueio, aviso de privacidade e orçamento seguem o real
  const decision = await classify(deps, ctx, pending, agoraDaConversa(now, ctx.conv))
  try {
    const lastNotice = ctx.customer.privacyNoticeSentAt?.getTime() ?? 0
    const [noticePending] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), eq(messages.replyKey, 'avisoPrivacidade'), eq(messages.statusEnvio, 'pendente')))
      .limit(1)
    const needsNotice = !noticePending && now.getTime() - lastNotice > PRIVACY_RENOTICE_MS
    if (needsNotice) decision.replies.unshift('avisoPrivacidade')
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

async function classify(deps: ProcessDeps, ctx: Ctx, pending: Pending[], now: Date): Promise<Decision> {
  const pre = prefilter(pending)
  if (pre.kind === 'pass') {
    const daLista = await respostaDaLista(deps, ctx, pending, now)
    if (daLista) return daLista
    const pessoas = await respostaDePessoas(deps, ctx, pending, now)
    if (pessoas) return pessoas
  }
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
      return triageDecision(deps, ctx, pre.text, now)
  }
}

const perguntaMascarada = (texto: string) => redactPii(texto).slice(0, MAX_PERGUNTA)

function lerPendente(v: unknown): Pendente | null {
  const r = pendenteSchema.safeParse(v)
  return r.success ? r.data : null
}

/** Contexto do S1 + avisos ativos do cliente de hoje (relógio da conversa) em diante. */
async function carregarAtendimento(deps: ProcessDeps, ctx: Ctx, now: Date) {
  const s1 = await carregarContextoS1(deps.db, ctx.restaurant.id, now)
  const avisos = await avisosAtivosDoCliente(deps.db, {
    restaurantId: ctx.restaurant.id, customerId: ctx.customer.id, aPartirDe: agoraLocal(now, s1.timezone).data,
  })
  return { s1, avisos }
}

/** Cliente escolheu a unidade na lista (ou digitou o nome): responde os itens guardados sem chamar o LLM. */
async function respostaDaLista(deps: ProcessDeps, ctx: Ctx, pending: Pending[], now: Date): Promise<Decision | null> {
  if (pending.length !== 1) return null
  const ultimo = pending[0]!
  const lido = interativoSchema.safeParse(ultimo.payload)
  const idLista = lido.success ? lido.data.interativoId : null
  const lidoPendente = lerPendente(ctx.conv.pendente)
  const p = lidoPendente?.tipo === 'unidade' ? lidoPendente : null
  if (!p || new Date(p.expiraEm) <= now) {
    // toque numa lista que já não vale: avisa sem gastar o modelo
    if (!idLista) return null
    const { modelos } = await carregarContextoS1(deps.db, ctx.restaurant.id, now)
    const run: AiRunRow = { etapa: 'resposta', modelo: 'deterministico', promptVersion: 's1-lista', costUsd: '0', intent: 'lista_expirada', resultado: 'ok' }
    return {
      replies: [], saidas: [{ tipo: 'texto', texto: renderModelo('lista_expirada', {}, modelos) }],
      autor: 'ia', falhas: 'zerar', pendente: null, runs: [run],
    }
  }
  const texto = ultimo.texto?.trim() ?? ''
  if (!idLista && (!texto || texto.split(/\s+/).length > MAX_PALAVRAS_ESCOLHA)) return null
  const { s1, avisos } = await carregarAtendimento(deps, ctx, now)
  const opcoes = s1.unidades.filter((u) => p.opcoes.includes(u.id))
  const escolhida = idLista ? opcoes.find((u) => u.id === idLista) : escolhaDeUnidade(texto, opcoes)
  if (!escolhida) return null
  const r = resolverAtendimento(p.itens, s1, now, avisos, escolhida.id)
  const run: AiRunRow = {
    etapa: 'resposta', modelo: 'deterministico', promptVersion: 's1-lista', costUsd: '0', intent: 'escolha_unidade', resultado: 'ok',
  }
  // o pendente da decisão vale: o aviso escolhido sem pessoas passa a esperar "Para quantas pessoas?"
  return { ...decisaoAtendimento(r, now, p.pergunta), runs: [run] }
}

/** Resposta curta ("4", "só eu") ao "Para quantas pessoas?": registra o aviso guardado sem chamar o LLM. */
async function respostaDePessoas(deps: ProcessDeps, ctx: Ctx, pending: Pending[], now: Date): Promise<Decision | null> {
  if (pending.length !== 1 || pending[0]!.tipo !== 'texto') return null
  const p = lerPendente(ctx.conv.pendente)
  if (p?.tipo !== 'pessoas' || new Date(p.expiraEm) <= now) return null
  const n = lerPessoas(pending[0]!.texto ?? '')
  if (n === null) return null // resposta ambígua: a triagem decide (e substitui o pendente)
  const { s1, avisos } = await carregarAtendimento(deps, ctx, now)
  // "somos 80": o core responde o limite (aviso_pessoas_invalido) e não guarda pendente ⇒ sem laço
  const pessoas = n === 'fora' ? MAX_PESSOAS + 1 : n
  // unidade pelo id guardado: não reabre a lista nem confunde nomes parecidos
  const r = resolverAtendimento([{ ...p.item, pessoas }], s1, now, avisos, p.unitId)
  const run: AiRunRow = {
    etapa: 'resposta', modelo: 'deterministico', promptVersion: 's2-pessoas', costUsd: '0', intent: 'resposta_pessoas', resultado: 'ok',
  }
  return { ...decisaoAtendimento(r, now, p.pergunta), runs: [run] }
}

function decisaoAtendimento(r: ResultadoAtendimento, now: Date, pergunta: string): Decision {
  const saidas: Saida[] = []
  if (r.texto) saidas.push({ tipo: 'texto', texto: r.texto })
  for (const l of r.localizacoes) saidas.push({ tipo: 'localizacao', texto: `${l.nome}: ${l.endereco}`, payload: l })
  if (r.lista) saidas.push({ tipo: 'lista', texto: r.lista.corpo, payload: { botao: r.lista.botao, opcoes: r.lista.opcoes } })
  const expiraEm = new Date(now.getTime() + PENDENTE_MIN * 60_000).toISOString()
  const pendente: Pendente | null = r.lista && r.pendente.length
    ? { tipo: 'unidade', pergunta, itens: r.pendente, opcoes: r.lista.opcoes.map((o) => o.id), expiraEm }
    : r.perguntarPessoas
      ? { tipo: 'pessoas', pergunta, item: r.perguntarPessoas.item, unitId: r.perguntarPessoas.unitId, expiraEm }
      : null
  return {
    replies: saidas.length ? [] : ['foraEscopo'],
    saidas,
    autor: 'ia',
    falhas: 'zerar',
    lacunas: r.lacunas,
    pergunta,
    contagem: { validos: r.validos, respondidos: r.respondidos },
    pendente,
    avisos: r.acoesS2,
  }
}

const fmt = (m: number) => (m / 1_000_000).toFixed(6)
const micros = (usd: string) => Math.round(Number(usd) * 1_000_000)
const ESTIMATE_MICROS = micros(TRIAGE_BUDGET_ESTIMATE_USD)
const RESERVE_USD = fmt(2 * ESTIMATE_MICROS)

// Custo desconhecido (null) de chamada possivelmente cobrada é contabilizado pela estimativa;
// falha sem uso reportado (502, rede) não custa nada.
function runCostMicros(r: JsonCallResult<TriageV3>): number {
  if (r.usage?.costUsd != null) return micros(r.usage.costUsd)
  const maybeBilled = r.ok || r.usage !== null
  return maybeBilled ? ESTIMATE_MICROS : 0
}


function resumoItens(t: TriageV3): string {
  if (t.itens.length === 0) return 'fora_escopo'
  return [...new Set(t.itens.map((i) => (i.tipo ? `${i.servico}:${i.tipo}` : i.servico)))].join(',')
}

function toRun(r: JsonCallResult<TriageV3>, fallbackModel: string): AiRunRow {
  return {
    etapa: 'triagem',
    modelo: r.model ?? fallbackModel,
    promptVersion: TRIAGE_V3_PROMPT_VERSION,
    tokensIn: r.usage?.tokensIn ?? 0,
    tokensOut: r.usage?.tokensOut ?? 0,
    tokensCache: r.usage?.tokensCache ?? 0,
    costUsd: fmt(runCostMicros(r)),
    latenciaMs: r.latencyMs,
    intent: r.ok ? resumoItens(r.data) : null,
    resultado: r.ok ? 'ok' : 'erro',
    erro: r.ok ? null : r.error,
  }
}

async function triageDecision(deps: ProcessDeps, ctx: Ctx, text: string, now: Date): Promise<Decision> {
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

  let result: JsonCallResult<TriageV3>
  const runs: AiRunRow[] = []
  try {
    const call = () => triageV3(deps.llm, { models: deps.triageModels, restaurante: ctx.restaurant.nome, text })
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
    return { replies: ['erro'], autor: 'sistema', novoEstado: 'aguardando_humano', falhas: 'incrementar', audit: 'ia.falha_triagem', runs, budget, pendente: null }
  }

  const { itens } = result.data
  if (itens.some((i) => i.servico === 'humano' || i.servico === 'lgpd')) {
    return { replies: ['handoff'], autor: 'ia', novoEstado: 'aguardando_humano', audit: 'conversa.handoff_triagem', runs, budget, pendente: null }
  }
  if (itens.length === 0) return { replies: ['foraEscopo'], autor: 'ia', falhas: 'zerar', runs, budget, pendente: null }
  try {
    const { s1, avisos } = await carregarAtendimento(deps, ctx, now)
    return { ...decisaoAtendimento(resolverAtendimento(itens, s1, now, avisos), now, perguntaMascarada(text)), runs, budget }
  } catch (err) {
    await compensate(deps, reservation, spentMicros, ctx.conv.id)
    throw err
  }
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
    const runs = d.runs ?? []
    for (const [i, run] of runs.entries()) {
      const contagem = i === runs.length - 1 && d.contagem
        ? { itensValidos: d.contagem.validos, itensRespondidos: d.contagem.respondidos }
        : {}
      const [row] = await tx.insert(aiRuns)
        .values({ ...run, ...contagem, simulado: ctx.conv.simulada, restaurantId, conversationId })
        .returning({ id: aiRuns.id })
      lastRunId = row!.id
    }
    if (d.budget) {
      const ref = `conversa:${conversationId}`
      if (d.budget.spentMicros > 0) await settleBudget(tx, d.budget.reservation, fmt(d.budget.spentMicros), ref)
      else await releaseBudget(tx, d.budget.reservation, ref)
    }
    if (alreadyDone) return 'nothing'
    if (humanOwns) {
      await tx.update(conversations).set({ processedUpToId: upTo, pendente: null }).where(eq(conversations.id, conversationId))
      return 'human_state'
    }

    // avisos de presença: na mesma transação da resposta; com humano no controle, nada é gravado (acima)
    let saidas = d.saidas ?? []
    for (const a of d.avisos ?? []) {
      if (a.tipo === 'registrar') {
        const r = await registrarAviso(tx, {
          restaurantId, customerId: ctx.customer.id, unitId: a.unitId, data: a.data, pessoas: a.pessoas,
          horarioAprox: a.horarioAprox, nome: ctx.customer.nomePerfil, simulado: ctx.conv.simulada,
        })
        await tx.insert(auditLog).values({ restaurantId, atorTipo: 'ia', acao: r.atualizado ? 'aviso.atualizado' : 'aviso.registrado', entidade: 'attendance_notice', entidadeId: r.id })
      } else {
        const ok = await cancelarAvisoDoCliente(tx, { restaurantId, customerId: ctx.customer.id, avisoId: a.avisoId })
        if (ok) await tx.insert(auditLog).values({ restaurantId, atorTipo: 'ia', acao: 'aviso.cancelado', entidade: 'attendance_notice', entidadeId: a.avisoId })
        else saidas = trocarTrecho(saidas, a.texto, a.textoSeFalhar) // a resposta diz o que o banco fez
      }
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

    for (const s of saidas) {
      await tx.insert(messages).values({
        restaurantId,
        conversationId,
        direcao: 'out',
        autor: d.autor,
        tipo: s.tipo,
        texto: s.texto,
        payload: s.tipo === 'texto' ? null : s.payload,
        statusEnvio: 'pendente',
        aiRunId: lastRunId,
        replyKey: 's1',
      })
    }
    if (d.lacunas?.length && !ctx.conv.simulada) {
      await registrarLacunas(tx, { restaurantId, lacunas: d.lacunas, pergunta: d.pergunta ?? '' })
    }

    await tx
      .update(conversations)
      .set({
        processedUpToId: upTo,
        ...(d.novoEstado ? { estado: d.novoEstado } : {}),
        ...(d.falhas === 'incrementar' ? { falhasConsecutivas: sql`${conversations.falhasConsecutivas} + 1` } : {}),
        ...(d.falhas === 'zerar' ? { falhasConsecutivas: 0 } : {}),
        ...(d.pendente !== undefined ? { pendente: d.pendente } : {}),
      })
      .where(eq(conversations.id, conversationId))

    if (d.dsr) await tx.insert(dataSubjectRequests).values({ restaurantId, customerId: ctx.customer.id, tipo: d.dsr })
    if (d.audit) {
      await tx.insert(auditLog).values({ restaurantId, atorTipo: d.autor, acao: d.audit, entidade: 'conversation', entidadeId: conversationId })
    }
    return d.replies.length + saidas.length > 0 ? 'replied' : 'nothing'
  })
}

/** Troca um trecho (parágrafo) do texto composto; o substituto aparece uma vez só. */
function trocarTrecho(saidas: Saida[], de: string, para: string): Saida[] {
  return saidas.map((s) => {
    if (s.tipo !== 'texto' || !s.texto.split('\n\n').includes(de)) return s
    const partes = s.texto.split('\n\n').map((p) => (p === de ? para : p))
    const texto = partes.filter((p, i) => p !== para || partes.indexOf(para) === i).join('\n\n')
    return { ...s, texto }
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
      tipo: messages.tipo,
      payload: messages.payload,
      telefoneCifrado: customers.telefoneCifrado,
      customerId: customers.id,
      estado: conversations.estado,
      simulada: conversations.simulada,
    })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .innerJoin(customers, eq(customers.id, conversations.customerId))
    .where(and(eq(messages.conversationId, conversationId), eq(messages.direcao, 'out'), eq(messages.statusEnvio, 'pendente')))
    .orderBy(asc(messages.id))
  if (pendingOut.length === 0) return

  // canal simulador: conversa do painel nunca chama a Meta nem decifra telefone
  const simulada = pendingOut[0]!.simulada
  const to = simulada ? null : decryptPhone(pendingOut[0]!.telefoneCifrado, deps.phoneKey)
  for (const m of pendingOut) {
    // I5: com humano no controle, respostas da IA ainda pendentes são canceladas; as do sistema seguem
    if (m.autor === 'ia') {
      const [cur] = await db.select({ estado: conversations.estado }).from(conversations).where(eq(conversations.id, conversationId))
      if (cur && cur.estado !== 'ia') {
        await db.update(messages).set({ statusEnvio: 'cancelado' }).where(eq(messages.id, m.id))
        continue
      }
    }
    if (to === null) {
      await db.update(messages).set({ statusEnvio: 'simulado' }).where(eq(messages.id, m.id))
      await marcarAvisoEnviado(deps, m)
      continue
    }
    const r = await enviar(deps, to, m)
    if (r === 'payload_invalido') {
      await db.update(messages).set({ statusEnvio: 'falhou:payload_invalido' }).where(eq(messages.id, m.id))
      deps.log.warn({ conversationId, messageId: m.id }, 'payload de mensagem interativa inválido; envio descartado')
      continue
    }
    if (r.ok) {
      await db.update(messages).set({ wamid: r.wamid, statusEnvio: 'enviado' }).where(eq(messages.id, m.id))
      await marcarAvisoEnviado(deps, m)
    } else if (!r.retryable) {
      await db.update(messages).set({ statusEnvio: `falhou:${r.code ?? 'desconhecido'}` }).where(eq(messages.id, m.id))
      deps.log.warn({ conversationId, code: r.code }, 'envio recusado permanentemente pela Meta')
    } else {
      throw new Error(`Falha temporária ao enviar pelo WhatsApp (código ${r.code ?? 'rede'})`)
    }
  }
}

async function marcarAvisoEnviado(deps: ProcessDeps, m: { replyKey: string | null; customerId: string }) {
  if (m.replyKey !== 'avisoPrivacidade') return
  await deps.db.update(customers).set({ privacyNoticeSentAt: deps.now?.() ?? new Date() }).where(eq(customers.id, m.customerId))
}

function enviar(deps: ProcessDeps, to: string, m: { tipo: string; texto: string | null; payload: unknown }) {
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
