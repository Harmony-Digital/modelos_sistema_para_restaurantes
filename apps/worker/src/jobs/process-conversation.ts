import { createHash } from 'node:crypto'
import { and, asc, count, eq, gt, gte, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  agoraLocal, decryptPhone, encontrarUnidade, escolhaDeUnidade, ESPACO_QUALQUER, normalizarHorario, normalizeText, lerPessoas, MAX_PESSOAS, normalizarTipoEvento, prefilter, redactPii,
  renderModelo, renderReply, resolverAtendimento, resolverS4, rotuloTipoEvento, SERVICOS, TAGS_CARDAPIO, TIPOS_S1, TIPOS_S2, TIPOS_S3,
  TIPOS_S4, unidadesOrdenadas,
  type AcaoS2, type AcaoS3, type AcaoS4, type ContextoAtendimentoS4, type ContextoS1, type InboundItem, type ItemExtraido, type UnidadeS1,
  type Lacuna, type ListaUnidades, type Localizacao, type ReplyKey, type ResultadoAtendimento,
} from '@atd/core'
import {
  arquivoAtivoPorId, arquivoParaEnvio, avisosAtivosDoCliente, buscarCardapio, cancelarAvisoDoCliente, cancelarPedidoDoCliente,
  carregarContextoS1, espacosAtivos, guardarMidiaMeta, limparMidiaMeta, observarPedidoDoCliente, pedidosDoCliente, registrarAviso,
  registrarLacunas, registrarPedidoEvento, releaseBudget, reserveBudget, resumoCardapio, schema, settleBudget, type ArquivoCardapio,
  type Db, type ItemEncontrado, type Reservation, type ResumoCardapioDb,
} from '@atd/db'
import {
  TRIAGE_BUDGET_ESTIMATE_USD, TRIAGE_V5_PROMPT_VERSION, triageV5, type JsonCallResult, type LlmClient, type PendenteTriagem,
  type TriageV5,
} from '@atd/ai'
import type { SendResult, WhatsAppClient } from '@atd/whatsapp'
import type { Logger } from '../logger.ts'
import { mimeDosBytes, type Storage } from '../storage.ts'

const { aiRuns, auditLog, conversations, customers, dataSubjectRequests, messages, restaurants } = schema

export type ProcessDeps = {
  db: Db
  llm: LlmClient
  wa: Pick<WhatsAppClient, 'sendText' | 'sendLocation' | 'sendList' | 'sendDocument' | 'sendImage' | 'uploadMedia'>
  /** arquivos do cardápio (bucket privado) para subir à Meta */
  storage: Pick<Storage, 'baixarObjeto'>
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
  /** arquivo do cardápio: `texto` é o título; `alternativa` é o resumo em texto se a mídia não puder ser entregue */
  | { tipo: 'documento' | 'imagem'; texto: string; payload: MidiaPayload }

type MidiaPayload = { arquivoId: string; alternativa: string }

/** Pergunta nossa guardada no pendente: cabe a de capacidade com todas as sugestões (nunca cortar a pergunta). */
const MAX_PERGUNTA_ENVIADA = 2000

const itemSchema = z.object({
  servico: z.enum(SERVICOS),
  tipo: z.enum([...TIPOS_S1, ...TIPOS_S2, ...TIPOS_S3, ...TIPOS_S4]).nullable(),
  unidade: z.string().nullable(),
  data: z.string().nullable(),
  tema: z.string().nullable(),
  // avisos de presença (Etapa 03): pendentes antigos não têm os campos
  // até 1000 como na triagem v3: acima de 60 o core responde o limite (o item precisa sobreviver no pendente de unidade)
  pessoas: z.number().int().min(1).max(1000).nullable().default(null),
  horario: z.string().max(40).nullable().default(null),
  // eventos (Etapa 04): idem
  convidados: z.number().nullable().default(null), // o core valida 1–1000 (o item cru espera a lista de unidade)
  tipoEvento: z.string().max(120).nullable().default(null),
  espaco: z.string().max(120).nullable().default(null),
  // cardápio (Etapa 05): idem
  consulta: z.string().max(120).nullable().default(null),
  tag: z.enum(TAGS_CARDAPIO).nullable().default(null),
})
// Em `unidade` e `pessoas`, `pergunta` é a mensagem do cliente (mascarada, para as lacunas) e `perguntaEnviada` é o
// texto nosso que espera a resposta (contexto da triagem; vazio em pendentes antigos).
// pendente antigo (sem `tipo`) é lido como 'unidade'
const pendenteUnidadeSchema = z.object({
  tipo: z.literal('unidade').default('unidade'),
  pergunta: z.string().max(300).default(''),
  perguntaEnviada: z.string().max(MAX_PERGUNTA_ENVIADA).default(''),
  itens: z.array(itemSchema).min(1).max(5),
  opcoes: z.array(z.string()).min(1).max(10),
  expiraEm: z.iso.datetime(),
})
const pendentePessoasSchema = z.object({
  tipo: z.literal('pessoas'),
  pergunta: z.string().max(300).default(''),
  perguntaEnviada: z.string().max(MAX_PERGUNTA_ENVIADA).default(''),
  item: itemSchema,
  unitId: z.string(),
  expiraEm: z.iso.datetime(),
})
// coleta guiada do pedido de evento (Etapa 04): `pergunta` é o texto nosso; `item` traz o que o core já validou
const pendentePedidoEventoSchema = z.object({
  tipo: z.literal('pedido_evento'),
  pergunta: z.string().max(MAX_PERGUNTA_ENVIADA),
  campo: z.enum(['unidade', 'data', 'convidados', 'tipo', 'espaco']),
  item: itemSchema,
  unitId: z.string().nullable().default(null),
  expiraEm: z.iso.datetime(),
})
const pendenteSchema = z.union([pendentePessoasSchema, pendentePedidoEventoSchema, pendenteUnidadeSchema])
type Pendente = z.infer<typeof pendenteSchema>
const localizacaoPayload = z.object({ lat: z.number(), lng: z.number(), nome: z.string(), endereco: z.string() })
const listaPayload = z.object({
  botao: z.string(),
  opcoes: z.array(z.object({ id: z.string(), titulo: z.string(), descricao: z.string() })).min(1).max(10),
})
const interativoSchema = z.object({ interativoId: z.string() })
const midiaPayload = z.object({ arquivoId: z.uuid(), alternativa: z.string().min(1) })

const PENDENTE_MIN = 30
const PENDENTE_EVENTO_MIN = 60
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
  acoesS3?: AcaoS3[]
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

/** Contexto do S1 + avisos, espaços de evento e pedidos do cliente de hoje (relógio da conversa) em diante. */
async function carregarAtendimento(deps: ProcessDeps, ctx: Ctx, now: Date) {
  const s1 = await carregarContextoS1(deps.db, ctx.restaurant.id, now)
  const doCliente = { restaurantId: ctx.restaurant.id, customerId: ctx.customer.id, aPartirDe: agoraLocal(now, s1.timezone).data }
  const avisos = await avisosAtivosDoCliente(deps.db, doCliente)
  const espacos = await espacosAtivos(deps.db, ctx.restaurant.id)
  const pedidos = await pedidosDoCliente(deps.db, doCliente)
  return { s1, avisos, s3: { espacos, pedidos } }
}

type Atendimento = Awaited<ReturnType<typeof carregarAtendimento>>

type DadosS4 = {
  contexto: ContextoAtendimentoS4
  resumo: ResumoCardapioDb
  /** arquivo ativo para a unidade (o da unidade, senão o geral) */
  arquivoDe: (unitId: string | null) => ArquivoCardapio | null
}

/** Imagem acima disso a Meta não aceita como imagem: vai como documento. */
const MAX_IMAGEM_META = 5 * 1024 * 1024
const ITEM_ENVIAR: ItemExtraido = {
  servico: 'cardapio', tipo: 'enviar', unidade: null, data: null, tema: null, pessoas: null, horario: null, convidados: null,
  tipoEvento: null, espaco: null, consulta: null, tag: null,
}
const temConsulta = (i: ItemExtraido) => !!i.consulta?.trim()

/**
 * Dados do cardápio para os itens S4 da mensagem (antes de resolver): a busca de cada item (por índice), o arquivo de
 * cada unidade citada (e o geral) e o resumo (só quando algum item é de envio). Sem item de cardápio, nada é lido.
 */
async function carregarS4(
  deps: ProcessDeps,
  ctx: Ctx,
  itens: readonly ItemExtraido[],
  s1: ContextoS1,
  escolhidaId: string | undefined,
): Promise<DadosS4 | undefined> {
  const doCardapio = itens.flatMap((item, indice) => (item.servico === 'cardapio' ? [{ item, indice }] : []))
  if (doCardapio.length === 0) return undefined
  const restaurantId = ctx.restaurant.id
  const unidades = unidadesOrdenadas(s1)
  const unidadeDe = (i: ItemExtraido) =>
    (escolhidaId ? unidades.find((u) => u.id === escolhidaId)?.id : undefined) ?? encontrarUnidade(i.unidade, unidades)?.id ?? null
  const achados = new Map<number, ItemEncontrado[]>()
  for (const { item, indice } of doCardapio) {
    if (item.tipo === 'enviar' || (!temConsulta(item) && !item.tag)) continue
    // filtro por tag: só a tag (a consulta do modelo costuma repetir o nome da tag)
    const consulta = item.tipo === 'filtro' && item.tag ? null : item.consulta
    achados.set(indice, await buscarCardapio(deps.db, { restaurantId, consulta, tag: item.tag }))
  }
  const envios = doCardapio.filter(({ item }) => item.tipo === 'enviar' || (!temConsulta(item) && !item.tag))
  const arquivos = new Map<string | null, ArquivoCardapio | null>()
  for (const unitId of new Set([null, ...envios.map(({ item }) => unidadeDe(item))])) {
    arquivos.set(unitId, await arquivoParaEnvio(deps.db, { restaurantId, unitId }))
  }
  // resumo com preço efetivo: da unidade citada; uma unidade ativa só ⇒ a dela; várias e nenhuma citada ⇒ todas
  // (item com preço diferente entre unidades sai sem preço; indisponível em todas não aparece)
  const unidadeDoResumo = envios.length ? (unidadeDe(envios[0]!.item) ?? (unidades.length === 1 ? unidades[0]!.id : 'todas')) : null
  const resumo = envios.length ? await resumoCardapio(deps.db, restaurantId, unidadeDoResumo) : []
  const arquivoDe = (unitId: string | null) => (arquivos.has(unitId) ? arquivos.get(unitId)! : (arquivos.get(null) ?? null))
  return { contexto: { achados, resumo, temArquivo: (unitId) => arquivoDe(unitId) !== null }, resumo, arquivoDe }
}

/** Mensagens de mídia das ações do S4 (o texto "Aqui está…" já veio do core), cada uma com o resumo para o caso de falha. */
function midiasS4(acoes: readonly AcaoS4[], dados: DadosS4 | undefined, s1: ContextoS1): Saida[] {
  if (!dados) return []
  const enviados = new Set<string>()
  return acoes.flatMap((a): Saida[] => {
    const arquivo = dados.arquivoDe(a.unitId)
    // duas unidades sem arquivo próprio caem no mesmo geral: um envio só
    if (!arquivo || enviados.has(arquivo.id)) return []
    enviados.add(arquivo.id)
    const semArquivo = resolverS4([ITEM_ENVIAR], s1, new Map(), dados.resumo, () => false, a.unitId ?? undefined)
    const alternativa = semArquivo.texto ?? renderModelo('lacuna', {}, s1.modelos)
    const imagem = (arquivo.mime === 'image/jpeg' || arquivo.mime === 'image/png') && arquivo.tamanho <= MAX_IMAGEM_META
    return [{ tipo: imagem ? 'imagem' : 'documento', texto: arquivo.titulo, payload: { arquivoId: arquivo.id, alternativa } }]
  })
}

/** Resolve S1–S4 da mesma mensagem (lê o cardápio antes, se houver item de cardápio). */
async function atender(
  deps: ProcessDeps,
  ctx: Ctx,
  { s1, avisos, s3 }: Atendimento,
  itens: readonly ItemExtraido[],
  now: Date,
  escolhidaId: string | undefined,
): Promise<{ r: ResultadoAtendimento; midias: Saida[] }> {
  const s4 = await carregarS4(deps, ctx, itens, s1, escolhidaId)
  const r = resolverAtendimento(itens, s1, now, avisos, escolhidaId, s3, s4?.contexto)
  return { r, midias: midiasS4(r.acoesS4, s4, s1) }
}

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/

/**
 * O que já sabemos do pedido para a triagem v4: só valores validados (unidade pelo nome do banco, data ISO, números,
 * tipo normalizado, espaço "*"); nunca texto livre do cliente.
 */
function conhecidoDe(item: ItemExtraido, unidadeValidada: boolean): Record<string, string | number> {
  const c: Record<string, string | number> = { servico: item.servico }
  if (unidadeValidada && item.unidade) c.unidade = item.unidade
  if (item.data && DATA_ISO.test(item.data)) c.data = item.data
  if (item.convidados !== null) c.convidados = item.convidados
  const tipo = normalizarTipoEvento(item.tipoEvento)
  if (tipo) c.tipo = tipo.tipo === 'outro' ? 'outro' : rotuloTipoEvento(tipo.tipo, null)
  if (item.espaco === ESPACO_QUALQUER) c.espaco = ESPACO_QUALQUER
  if (item.pessoas !== null) c.pessoas = item.pessoas
  const horario = normalizarHorario(item.horario).hhmm // só HH:mm; texto livre ("à noite") não vai
  if (horario) c.horario = horario
  return c
}

/** Pergunta pendente (texto nosso) e o que já sabemos; nada quando vencido ou antigo (sem o texto enviado). */
function pendenteDaTriagem(p: Pendente | null, now: Date): PendenteTriagem | null {
  if (!p || new Date(p.expiraEm) <= now) return null
  if (p.tipo === 'pedido_evento') return { pergunta: p.pergunta, conhecido: conhecidoDe(p.item, true) }
  if (!p.perguntaEnviada) return null
  if (p.tipo === 'pessoas') return { pergunta: p.perguntaEnviada, conhecido: conhecidoDe(p.item, true) }
  return { pergunta: p.perguntaEnviada, conhecido: conhecidoDe(p.itens[0]!, false) }
}

/**
 * Resposta a um `pedido_evento`: não depende de o modelo repetir o que já sabemos. Cada item de pedido de evento sem
 * unidade (ou com a mesma unidade, pela busca tolerante) herda do pendente os campos que vieram vazios — inclusive o
 * que não vai à triagem (espaço citado, tipo "outro" como o cliente escreveu). O que o cliente disse agora vale
 * (correção explícita). Se todos os itens são desse pedido, a unidade é resolvida pelo id guardado.
 */
function completarDoPendente(
  itens: readonly ItemExtraido[],
  p: Pendente | null,
  unidades: readonly UnidadeS1[],
): { itens: ItemExtraido[]; escolhidaId: string | undefined } {
  if (p?.tipo !== 'pedido_evento') return { itens: [...itens], escolhidaId: undefined }
  const unitId = p.unitId ?? encontrarUnidade(p.item.unidade, unidades)?.id ?? null
  const doPedido = (i: ItemExtraido) =>
    i.servico === 'evento' && (i.tipo === 'pedido' || i.tipo === null)
    && (!i.unidade || (unitId !== null && encontrarUnidade(i.unidade, unidades)?.id === unitId))
  const completos = itens.map((i) => {
    if (!doPedido(i)) return i
    // "outro" sozinho é o eco do `conhecido`; o texto original do cliente está no pendente
    const tipoVago = !i.tipoEvento || normalizeText(i.tipoEvento) === 'outro'
    return {
      ...i,
      tipo: 'pedido' as const,
      unidade: p.item.unidade,
      data: i.data ?? p.item.data,
      convidados: i.convidados ?? p.item.convidados,
      tipoEvento: tipoVago ? (p.item.tipoEvento ?? i.tipoEvento) : i.tipoEvento,
      espaco: i.espaco ?? p.item.espaco,
    }
  })
  const todos = unitId !== null && itens.length > 0 && itens.every(doPedido)
  return { itens: completos, escolhidaId: todos ? unitId : undefined }
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
  const atendimento = await carregarAtendimento(deps, ctx, now)
  const opcoes = atendimento.s1.unidades.filter((u) => p.opcoes.includes(u.id))
  const escolhida = idLista ? opcoes.find((u) => u.id === idLista) : escolhaDeUnidade(texto, opcoes)
  if (!escolhida) return null
  // o pedido de evento sem unidade segue a coleta: a decisão guarda o pendente do próximo campo
  const { r, midias } = await atender(deps, ctx, atendimento, p.itens, now, escolhida.id)
  const run: AiRunRow = {
    etapa: 'resposta', modelo: 'deterministico', promptVersion: 's1-lista', costUsd: '0', intent: 'escolha_unidade', resultado: 'ok',
  }
  // o pendente da decisão vale: o aviso escolhido sem pessoas passa a esperar "Para quantas pessoas?"
  return { ...decisaoAtendimento(r, now, p.pergunta, midias), runs: [run] }
}

/** Resposta curta ("4", "só eu") ao "Para quantas pessoas?": registra o aviso guardado sem chamar o LLM. */
async function respostaDePessoas(deps: ProcessDeps, ctx: Ctx, pending: Pending[], now: Date): Promise<Decision | null> {
  if (pending.length !== 1 || pending[0]!.tipo !== 'texto') return null
  const p = lerPendente(ctx.conv.pendente)
  if (p?.tipo !== 'pessoas' || new Date(p.expiraEm) <= now) return null
  const n = lerPessoas(pending[0]!.texto ?? '')
  if (n === null) return null // resposta ambígua: a triagem decide (e substitui o pendente)
  // "somos 80": o core responde o limite (aviso_pessoas_invalido) e não guarda pendente ⇒ sem laço
  const pessoas = n === 'fora' ? MAX_PESSOAS + 1 : n
  // unidade pelo id guardado: não reabre a lista nem confunde nomes parecidos
  const { r } = await atender(deps, ctx, await carregarAtendimento(deps, ctx, now), [{ ...p.item, pessoas }], now, p.unitId)
  const run: AiRunRow = {
    etapa: 'resposta', modelo: 'deterministico', promptVersion: 's2-pessoas', costUsd: '0', intent: 'resposta_pessoas', resultado: 'ok',
  }
  return { ...decisaoAtendimento(r, now, p.pergunta), runs: [run] }
}

/** A pergunta que espera resposta sai por último no texto composto (um parágrafo). */
const ultimoTrecho = (texto: string | null) => (texto?.split('\n\n').at(-1) ?? '').slice(0, MAX_PERGUNTA_ENVIADA)

function decisaoAtendimento(r: ResultadoAtendimento, now: Date, pergunta: string, midias: readonly Saida[] = []): Decision {
  const saidas: Saida[] = []
  if (r.texto) saidas.push({ tipo: 'texto', texto: r.texto })
  saidas.push(...midias) // o arquivo do cardápio logo depois do "Aqui está o nosso cardápio."
  for (const l of r.localizacoes) saidas.push({ tipo: 'localizacao', texto: `${l.nome}: ${l.endereco}`, payload: l })
  if (r.lista) saidas.push({ tipo: 'lista', texto: r.lista.corpo, payload: { botao: r.lista.botao, opcoes: r.lista.opcoes } })
  const expira = (min: number) => new Date(now.getTime() + min * 60_000).toISOString()
  const ev = r.perguntarEvento
  // um pendente por vez: lista (inclui o pedido de evento sem unidade) > pessoas (S2) > próximo campo do evento
  const pendente: Pendente | null = r.handoff
    ? null
    : r.lista && r.pendente.length
      ? {
        tipo: 'unidade', pergunta, perguntaEnviada: r.lista.corpo.slice(0, MAX_PERGUNTA_ENVIADA), itens: r.pendente,
        opcoes: r.lista.opcoes.map((o) => o.id),
        // a lista que espera a unidade do pedido de evento vale o mesmo que as outras perguntas da coleta
        expiraEm: expira(r.pendente.some((i) => i.servico === 'evento') ? PENDENTE_EVENTO_MIN : PENDENTE_MIN),
      }
      : r.perguntarPessoas
        ? {
          tipo: 'pessoas', pergunta, perguntaEnviada: ultimoTrecho(r.texto), item: r.perguntarPessoas.item,
          unitId: r.perguntarPessoas.unitId, expiraEm: expira(PENDENTE_MIN),
        }
        : ev && ev.campo !== 'unidade'
          ? {
            tipo: 'pedido_evento', pergunta: ultimoTrecho(r.texto), campo: ev.campo, item: ev.item, unitId: ev.unitId,
            expiraEm: expira(PENDENTE_EVENTO_MIN),
          }
          : null
  return {
    replies: saidas.length ? [] : ['foraEscopo'],
    saidas,
    // handoff: a resposta é do sistema para não ser cancelada na entrega (a conversa já não está com a IA)
    autor: r.handoff ? 'sistema' : 'ia',
    falhas: 'zerar',
    lacunas: r.lacunas,
    pergunta,
    contagem: { validos: r.validos, respondidos: r.respondidos },
    pendente,
    avisos: r.acoesS2,
    acoesS3: r.acoesS3,
    ...(r.handoff ? { novoEstado: 'aguardando_humano' as const, audit: 'conversa.handoff_evento' } : {}),
  }
}

const fmt = (m: number) => (m / 1_000_000).toFixed(6)
const micros = (usd: string) => Math.round(Number(usd) * 1_000_000)
const ESTIMATE_MICROS = micros(TRIAGE_BUDGET_ESTIMATE_USD)
const RESERVE_USD = fmt(2 * ESTIMATE_MICROS)

// Custo desconhecido (null) de chamada possivelmente cobrada é contabilizado pela estimativa;
// falha sem uso reportado (502, rede) não custa nada.
function runCostMicros(r: JsonCallResult<TriageV5>): number {
  if (r.usage?.costUsd != null) return micros(r.usage.costUsd)
  const maybeBilled = r.ok || r.usage !== null
  return maybeBilled ? ESTIMATE_MICROS : 0
}


function resumoItens(t: TriageV5): string {
  if (t.itens.length === 0) return 'fora_escopo'
  return [...new Set(t.itens.map((i) => (i.tipo ? `${i.servico}:${i.tipo}` : i.servico)))].join(',')
}

function toRun(r: JsonCallResult<TriageV5>, fallbackModel: string): AiRunRow {
  return {
    etapa: 'triagem',
    modelo: r.model ?? fallbackModel,
    promptVersion: TRIAGE_V5_PROMPT_VERSION,
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

  // a resposta a uma pergunta nossa vai com o contexto (Decisão 3); pendente vencido não conta
  const pendenteAtual = lerPendente(ctx.conv.pendente)
  const contexto = pendenteDaTriagem(pendenteAtual, now)
  let result: JsonCallResult<TriageV5>
  const runs: AiRunRow[] = []
  try {
    const call = () => triageV5(deps.llm, {
      models: deps.triageModels, restaurante: ctx.restaurant.nome, text, ...(contexto ? { pendente: contexto } : {}),
    })
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
    // resposta do sistema: com `ia` a entrega a cancelaria (a conversa já está aguardando humano)
    return { replies: ['handoff'], autor: 'sistema', novoEstado: 'aguardando_humano', audit: 'conversa.handoff_triagem', runs, budget, pendente: null }
  }
  if (itens.length === 0) return { replies: ['foraEscopo'], autor: 'ia', falhas: 'zerar', runs, budget, pendente: null }
  try {
    const atendimento = await carregarAtendimento(deps, ctx, now)
    const c = completarDoPendente(itens, contexto ? pendenteAtual : null, atendimento.s1.unidades)
    const { r, midias } = await atender(deps, ctx, atendimento, c.itens, now, c.escolhidaId)
    return { ...decisaoAtendimento(r, now, perguntaMascarada(text), midias), runs, budget }
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
    // pedidos de evento: idem; sempre `novo` (quem confirma é a equipe). Espaço de outra unidade: a FK composta recusa
    for (const a of d.acoesS3 ?? []) {
      if (a.tipo === 'registrar_evento') {
        const r = await registrarPedidoEvento(tx, {
          restaurantId, customerId: ctx.customer.id, unitId: a.unitId, spaceId: a.spaceId, data: a.data, convidados: a.convidados,
          tipo: a.tipoEvento, tipoTexto: a.tipoTexto, observacoes: a.observacoes, nome: ctx.customer.nomePerfil, simulado: ctx.conv.simulada,
        })
        await tx.insert(auditLog).values({ restaurantId, atorTipo: 'ia', acao: 'evento.pedido_criado', entidade: 'event_request', entidadeId: r.id })
      } else if (a.tipo === 'cancelar_evento') {
        const ok = await cancelarPedidoDoCliente(tx, { restaurantId, customerId: ctx.customer.id, pedidoId: a.pedidoId })
        if (ok) await tx.insert(auditLog).values({ restaurantId, atorTipo: 'ia', acao: 'evento.pedido_cancelado', entidade: 'event_request', entidadeId: a.pedidoId })
        else saidas = trocarTrecho(saidas, a.texto, a.textoSeFalhar)
      } else {
        // mudança pedida: a IA não altera o pedido; só anota (texto nosso, ≤ 300) para a equipe que assume
        const ok = await observarPedidoDoCliente(tx, { restaurantId, customerId: ctx.customer.id, pedidoId: a.pedidoId, observacao: a.observacao })
        if (ok) await tx.insert(auditLog).values({ restaurantId, atorTipo: 'ia', acao: 'evento.pedido_observado', entidade: 'event_request', entidadeId: a.pedidoId })
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
      restaurantId: messages.restaurantId,
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
    const entregue = m.tipo === 'documento' || m.tipo === 'imagem' ? await entregarMidia(deps, to, m) : await enviarSimples(deps, to, m)
    if (entregue === 'payload_invalido') {
      await db.update(messages).set({ statusEnvio: 'falhou:payload_invalido' }).where(eq(messages.id, m.id))
      deps.log.warn({ conversationId, messageId: m.id }, 'payload de mensagem inválido; envio descartado')
      continue
    }
    const { r, alternativa } = entregue
    if (r.ok && alternativa !== null) {
      // a mídia não pôde ser entregue e o resumo saiu em texto: o registro mostra o que o cliente recebeu
      await db.update(messages)
        .set({ tipo: 'texto', texto: alternativa, payload: null, wamid: r.wamid, statusEnvio: 'enviado' })
        .where(eq(messages.id, m.id))
    } else if (r.ok) {
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

async function enviarSimples(deps: ProcessDeps, to: string, m: { tipo: string; texto: string | null; payload: unknown }): Promise<Entrega | 'payload_invalido'> {
  const r = await enviar(deps, to, m)
  return r === 'payload_invalido' ? r : { r, alternativa: null }
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
 * Envia o arquivo do cardápio: usa o media id guardado se ainda vale; senão baixa do Storage e sobe para a Meta (e
 * guarda o id). Mídia recusada: esquece o id e sobe de novo uma vez. Sem como entregar o arquivo (desativado, Storage
 * fora, Meta recusando), manda o resumo em texto (`alternativa`). Falha temporária volta para o job tentar de novo.
 */
async function entregarMidia(
  deps: ProcessDeps,
  to: string,
  m: { id: number; tipo: string; payload: unknown; restaurantId: string },
): Promise<Entrega | 'payload_invalido'> {
  const p = midiaPayload.safeParse(m.payload)
  if (!p.success) return 'payload_invalido'
  const { arquivoId, alternativa } = p.data
  const emTexto = async (): Promise<Entrega> => ({ r: await deps.wa.sendText(to, alternativa), alternativa })
  const arquivo = await arquivoAtivoPorId(deps.db, { restaurantId: m.restaurantId, arquivoId })
  if (!arquivo) return emTexto()
  const agora = deps.now?.() ?? new Date()
  let mediaId = arquivo.waMediaId && arquivo.waMediaExpiresAt && arquivo.waMediaExpiresAt > agora ? arquivo.waMediaId : null
  for (let tentativa = 0; ; tentativa++) {
    if (!mediaId) {
      const up = await subirArquivo(deps, arquivo, agora)
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
    await limparMidiaMeta(deps.db, arquivo.id)
    if (tentativa >= 1) {
      deps.log.warn({ messageId: m.id, code: r.code }, 'Meta recusou a mídia do cardápio de novo; enviando o resumo em texto')
      return emTexto()
    }
    mediaId = null
  }
}

/** Baixa o arquivo do bucket privado e sobe para a Meta; guarda o media id. `sem_arquivo`: Storage não entregou. */
async function subirArquivo(deps: ProcessDeps, a: ArquivoCardapio, agora: Date) {
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
  if (up.ok) await guardarMidiaMeta(deps.db, { arquivoId: a.id, waMediaId: up.mediaId, expiraEm: new Date(agora.getTime() + VALIDADE_MIDIA_MS) })
  return up
}

