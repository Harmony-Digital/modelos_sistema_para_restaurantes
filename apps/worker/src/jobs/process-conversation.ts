import { and, asc, count, eq, gt, gte, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  agoraLocal, capturarTelefone, continuarReserva, decryptPhone, diasDaReserva, encontrarUnidade, encryptPhone, escolhaDeUnidade,
  ESPACO_QUALQUER, itemDoPedidoNaUnidade, MAX_NOME_RESERVA, normalizarHorario, normalizeText, normalizeWaId, lerPessoas,
  normalizarTipoEvento, prefilter, redactPii, temAgradecimentoOuDespedida, renderModelo, renderReply, resolverAtendimento, resolverS4, retomarPerguntaEvento,
  rotuloTipoEvento, SERVICOS, TAGS_CARDAPIO, TIPOS_S1, TIPOS_S2, TIPOS_S3, TIPOS_S4, unidadesOrdenadas, validarModelo,
  type AcaoS2, type AcaoS3, type AcaoS4, type ChaveModelo, type ContextoAtendimentoS4, type ContextoReserva, type ContextoS1,
  type InboundItem, type ItemExtraido, type PerguntaReserva, type RespostaNumero, type UnidadeS1, type Lacuna, type ListaUnidades,
  type Localizacao, type ReplyKey, type ResultadoAtendimento, type VagasUnidade,
} from '@atd/core'
import { horarioHumanoSchema, proximoHorarioHumano, textoProximoHorario, type HandoffMotivo } from '@atd/core/conversa'
import {
  arquivoParaEnvio, avisosAtivosDoCliente, buscarCardapio, cancelarAvisoDoCliente, cancelarPedidoDoCliente, statusPedidoDoCliente,
  carregarContextoS1, espacosAtivos, observarPedidoDoCliente, ocupacaoDoDia, pedidosDoCliente, registrarReserva,
  registrarLacunas, registrarPedidoEvento, releaseBudget, reserveBudget, resumoCardapio, schema, settleBudget, type ArquivoCardapio,
  type Db, type ItemEncontrado, type Reservation, type ResumoCardapioDb, type Tx,
} from '@atd/db'
import {
  TRIAGE_BUDGET_ESTIMATE_USD, TRIAGE_V7_PROMPT_VERSION, triageV7, type JsonCallResult, type LlmClient, type PendenteTriagem,
  type TriageV7,
} from '@atd/ai'
import { deliver, type DeliverDeps } from './deliver.ts'

const { aiRuns, auditLog, conversations, customers, dataSubjectRequests, messages, replyTemplates, restaurants, units } = schema

export type ProcessDeps = DeliverDeps & {
  llm: LlmClient
  triageModels: string[]
  requeue: (conversationId: string) => Promise<unknown>
}

export type Outcome = 'not_found' | 'nothing' | 'human_state' | 'blocked' | 'flood' | 'replied'

const FLOOD_LIMIT = 10
const PRIVACY_RENOTICE_MS = 365 * 24 * 3600_000

type AiRunRow = Omit<typeof aiRuns.$inferInsert, 'restaurantId' | 'conversationId'>

type Saida =
  /** `replyKey`: chave do modelo (mensagem de handoff); sem ela, `s1` */
  | { tipo: 'texto'; texto: string; replyKey?: ChaveModelo }
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
  // reserva (triage-v7): nome limpo pelo core e a resposta ao "pode usar este WhatsApp?". O número nunca fica aqui.
  nome: z.string().max(MAX_NOME_RESERVA).nullable().default(null),
  contato_ok: z.boolean().nullable().default(null),
})
// pergunta do pedido de evento escondida por outra pergunta (pessoas ou lista): feita depois da resposta (pendência 2)
const eventoAdiadoSchema = z.object({
  campo: z.enum(['data', 'convidados', 'tipo', 'espaco']),
  item: itemSchema,
  unitId: z.string().nullable(),
  texto: z.string().max(MAX_PERGUNTA_ENVIADA),
})
// Em `unidade` e `reserva`, `pergunta` é a mensagem do cliente (mascarada, para as lacunas) e `perguntaEnviada` é o
// texto nosso que espera a resposta (contexto da triagem; vazio em pendentes antigos).
// pendente antigo (sem `tipo`) é lido como 'unidade'
const pendenteUnidadeSchema = z.object({
  tipo: z.literal('unidade').default('unidade'),
  pergunta: z.string().max(300).default(''),
  perguntaEnviada: z.string().max(MAX_PERGUNTA_ENVIADA).default(''),
  itens: z.array(itemSchema).min(1).max(5),
  opcoes: z.array(z.string()).min(1).max(10),
  expiraEm: z.iso.datetime(),
  eventoAdiado: eventoAdiadoSchema.optional(),
})
/**
 * Reserva esperando um campo (um por vez) ou depois do lotado (`lotado`: "e no domingo?" continua daqui). `item` traz o
 * que o core já validou (nome limpo incluso); `tentativasNumero`: números inválidos já recebidos. O número de contato
 * nunca entra aqui: ele é capturado do texto bruto na resposta e vai cifrado na ação.
 */
const pendenteReservaSchema = z.object({
  tipo: z.literal('reserva'),
  campo: z.enum(['data', 'pessoas', 'horario', 'nome', 'contato', 'contato_numero', 'lotado']),
  pergunta: z.string().max(300).default(''),
  perguntaEnviada: z.string().max(MAX_PERGUNTA_ENVIADA).default(''),
  item: itemSchema,
  unitId: z.string().nullable(),
  tentativasNumero: z.number().int().min(0).max(1).default(0),
  expiraEm: z.iso.datetime(),
  eventoAdiado: eventoAdiadoSchema.optional(),
})
// "Para quantas pessoas?" do aviso de presença antigo (gravado antes da reserva, em conversa em andamento): lido como a
// reserva esperando as pessoas. Nunca é gravado de novo.
const pendentePessoasAntigoSchema = z.object({
  tipo: z.literal('pessoas'),
  pergunta: z.string().max(300).default(''),
  perguntaEnviada: z.string().max(MAX_PERGUNTA_ENVIADA).default(''),
  item: itemSchema,
  unitId: z.string(),
  expiraEm: z.iso.datetime(),
  eventoAdiado: eventoAdiadoSchema.optional(),
}).transform((p) => ({ ...p, tipo: 'reserva' as const, campo: 'pessoas' as const, tentativasNumero: 0 }))
// coleta guiada do pedido de evento (Etapa 04): `pergunta` é o texto nosso; `item` traz o que o core já validou
const pendentePedidoEventoSchema = z.object({
  tipo: z.literal('pedido_evento'),
  pergunta: z.string().max(MAX_PERGUNTA_ENVIADA),
  campo: z.enum(['unidade', 'data', 'convidados', 'tipo', 'espaco']),
  item: itemSchema,
  unitId: z.string().nullable().default(null),
  expiraEm: z.iso.datetime(),
})
const pendenteSchema = z.union([pendenteReservaSchema, pendentePessoasAntigoSchema, pendentePedidoEventoSchema, pendenteUnidadeSchema])
type Pendente = z.infer<typeof pendenteSchema>
/** O que gravamos (o lido pode ter campos que só o Zod completa, como `nome` em pendentes antigos). */
type PendenteGravado = z.input<typeof pendenteSchema>
type PendenteReserva = Extract<Pendente, { tipo: 'reserva' }>
type ReservaGravada = Extract<PendenteGravado, { tipo: 'reserva' }>
const interativoSchema = z.object({ interativoId: z.string() })

const PENDENTE_MIN = 30
const PENDENTE_EVENTO_MIN = 60
const MAX_PALAVRAS_ESCOLHA = 4
const MAX_PERGUNTA = 300
/** Falhas seguidas (triagem que falhou, sem resposta válida, fora do escopo) que passam a conversa para a equipe. */
const LIMITE_FALHAS = 2

type Pending = InboundItem & { id: number; payload: unknown }

/**
 * Passa a conversa para a equipe (`aguardando_humano` + motivo). `avisar`: `sempre` acrescenta a mensagem de handoff
 * (dentro/fora do horário da equipe ou frustração); `so_fora` só quando a equipe está fora do horário (a resposta já
 * diz que a equipe vai assumir, como no handoff de evento).
 */
type Handoff = { motivo: HandoffMotivo; avisar: 'sempre' | 'so_fora' }

type Decision = {
  replies: ReplyKey[]
  autor: 'ia' | 'sistema'
  handoff?: Handoff
  dsr?: 'acesso' | 'exclusao'
  audit?: string
  falhas?: 'incrementar' | 'zerar'
  runs?: AiRunRow[]
  budget?: { reservation: Reservation; spentMicros: number }
  saidas?: Saida[]
  lacunas?: Lacuna[]
  pergunta?: string
  avisos?: AcaoReserva[]
  acoesS3?: AcaoS3[]
  /** mensagens do cliente com o número de contato: guardadas mascaradas (o número fica só cifrado na reserva) */
  mascarar?: { id: number; texto: string }[]
  contagem?: { validos: number; respondidos: number }
  /** undefined = não mexe; null = limpa; objeto = grava */
  pendente?: PendenteGravado | null
  /** unidade resolvida nesta resposta (`unidade_contexto_id`); ausente = mantém a anterior */
  unidadeId?: string | undefined
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
  // número de contato respondendo à pergunta da reserva: a mensagem fica mascarada em qualquer caminho (humano no
  // controle, bloqueio, sem orçamento, resposta normal)
  const mascarar = mascaraDoContato(ctx, pending, agoraDaConversa(now, ctx.conv))
  const silent: Decision = { replies: [], autor: 'sistema', ...mascarar }

  if (ctx.conv.estado === 'humano' || ctx.conv.estado === 'aguardando_humano') {
    await commit(db, ctx, upTo, silent, now)
    return 'human_state'
  }
  if (ctx.customer.bloqueadoAte && ctx.customer.bloqueadoAte > now) {
    await commit(db, ctx, upTo, silent, now)
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
    await commit(db, ctx, upTo, { ...silent, audit: 'cliente.flood_bloqueado' }, now)
    deps.log.warn({ conversationId }, 'flood detectado; cliente bloqueado por 5 minutos')
    return 'flood'
  }

  // relógio simulado vale para S1 e pendente; bloqueio, aviso de privacidade e orçamento seguem o real
  const agora = agoraDaConversa(now, ctx.conv)
  const decision: Decision = { ...await classify(deps, ctx, pending, agora), ...mascarar }
  try {
    await completarHandoff(db, ctx, decision, agora)
    const lastNotice = ctx.customer.privacyNoticeSentAt?.getTime() ?? 0
    const [noticePending] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), eq(messages.replyKey, 'avisoPrivacidade'), eq(messages.statusEnvio, 'pendente')))
      .limit(1)
    const needsNotice = !noticePending && now.getTime() - lastNotice > PRIVACY_RENOTICE_MS
    if (needsNotice) decision.replies.unshift('avisoPrivacidade')
    return await commit(db, ctx, upTo, decision, agora)
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
    const daReserva = await respostaCurtaDaReserva(deps, ctx, pending, now)
    if (daReserva) return daReserva
  }
  switch (pre.kind) {
    case 'handoff':
      return { replies: [], autor: 'sistema', handoff: { motivo: 'pedido', avisar: 'sempre' }, audit: 'conversa.handoff_pedido' }
    case 'lgpd':
      return { replies: ['lgpdRecebido'], autor: 'sistema', dsr: pre.tipo, audit: 'lgpd.pedido_recebido' }
    case 'canned':
      // saudação/agradecimento: conversa normal, zera as falhas seguidas
      return { replies: [pre.reply], autor: 'sistema', falhas: 'zerar' }
    case 'unsupported_media':
      return { replies: ['midiaNaoSuportada'], autor: 'sistema' }
    case 'pass':
      return triageDecision(deps, ctx, pre.text, now)
  }
}

/**
 * Fecha a decisão de handoff: a resposta que leva as falhas seguidas ao limite vira handoff (`falhas`); todo handoff
 * sai do sistema (a entrega não cancela depois da mudança de estado), sem pendente, com a mensagem de handoff.
 */
async function completarHandoff(db: Db, ctx: Ctx, d: Decision, now: Date): Promise<void> {
  if (!d.handoff && d.falhas === 'incrementar' && ctx.conv.falhasConsecutivas + 1 >= LIMITE_FALHAS) {
    d.replies = d.replies.filter((k) => k !== 'foraEscopo')
    d.handoff = { motivo: 'falhas', avisar: 'sempre' }
    d.audit ??= 'conversa.handoff_falhas'
  }
  if (!d.handoff) return
  d.autor = 'sistema'
  d.pendente = null
  const aviso = await mensagemHandoff(db, ctx, d.handoff, now)
  if (aviso) d.saidas = [...(d.saidas ?? []), aviso]
}

/**
 * Mensagem de handoff: fora do horário da equipe (com próxima abertura) ⇒ `handoff_fora` com o próximo horário; senão
 * `handoff_frustracao` (frustração) ou `handoff_dentro`. Horário vazio ou inválido no banco ⇒ sem promessa de horário.
 * Modelo personalizado do restaurante vale se for válido.
 */
async function mensagemHandoff(db: Db | Tx, ctx: Ctx, h: Handoff, now: Date): Promise<Saida | null> {
  const tz = ctx.restaurant.timezone
  const horario = horarioHumanoSchema.safeParse(ctx.restaurant.horarioAtendimentoHumano)
  const estado = horario.success ? proximoHorarioHumano(horario.data, now, tz) : null
  const proximo = estado && !estado.aberto ? estado.proximo : null
  if (!proximo && h.avisar === 'so_fora') return null
  const chave: ChaveModelo = proximo ? 'handoff_fora' : h.motivo === 'frustracao' ? 'handoff_frustracao' : 'handoff_dentro'
  const vars = proximo ? { proximo_horario: textoProximoHorario(proximo, now, tz) } : {}
  return saidaDoModelo(db, ctx, chave, vars)
}

/** Texto de um modelo editável: o personalizado do restaurante, se for válido; senão o padrão. */
async function saidaDoModelo(db: Db | Tx, ctx: Ctx, chave: ChaveModelo, vars: Record<string, string>): Promise<Saida> {
  const [linha] = await db
    .select({ texto: replyTemplates.texto })
    .from(replyTemplates)
    .where(and(eq(replyTemplates.restaurantId, ctx.restaurant.id), eq(replyTemplates.chave, chave)))
  const personalizado = linha && validarModelo(chave, linha.texto) === null ? { [chave]: linha.texto } : {}
  return { tipo: 'texto', texto: renderModelo(chave, vars, personalizado), replyKey: chave }
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

/**
 * Ação da reserva como o worker a executa no commit: o contato já cifrado (`undefined` = mantém o da reserva; null = o
 * próprio WhatsApp) — o número em claro não passa daqui. `seLotado`: pendente gravado quando o banco recusa por
 * lotação (corrida), para "e no domingo?" continuar; `textoSeIndisponivel`: a reserva mudou de estado no meio.
 */
type AcaoReserva =
  | Exclude<AcaoS2, { tipo: 'registrar' }>
  | (Omit<Extract<AcaoS2, { tipo: 'registrar' }>, 'contato'> & {
    contatoCifrado: string | null | undefined
    seLotado: ReservaGravada
    textoSeIndisponivel: string
  })

/** O que a mensagem responde da reserva pendente: a pergunta e o número capturado do texto bruto. */
type RespostaDaReserva = { pergunta?: PerguntaReserva; numero?: RespostaNumero }

type Atendido = { r: ResultadoAtendimento; midias: Saida[]; unidadeId: string | undefined; avisos: AcaoReserva[] }

/** Resolve S1–S4 da mesma mensagem (lê o cardápio e a ocupação dos dias da reserva antes). */
async function atender(
  deps: ProcessDeps,
  ctx: Ctx,
  { s1, avisos, s3 }: Atendimento,
  itens: readonly ItemExtraido[],
  now: Date,
  escolhidaId: string | undefined,
  resposta: RespostaDaReserva = {},
): Promise<Atendido> {
  itens = semNomeDeLugar(itens, nomesDeLugar(s1, ctx.restaurant.nome))
  const s4 = await carregarS4(deps, ctx, itens, s1, escolhidaId)
  const reserva = await contextoReserva(deps, ctx, itens, s1, avisos, now, resposta)
  const r = resolverAtendimento(itens, s1, now, avisos, escolhidaId, s3, s4?.contexto, reserva)
  return {
    r, midias: midiasS4(r.acoesS4, s4, s1), unidadeId: unidadeDaResposta(r, itens, s1.unidades, escolhidaId),
    avisos: r.acoesS2.map((a) => acaoDoWorker(a, deps.phoneKey, s1, now)),
  }
}

/**
 * Lotação dos dias citados nas reservas da mensagem, de todas as unidades ativas (a oferta de lotado cita outras
 * unidades com vaga), com o mesmo `simulado` da conversa. Leitura sem trava: o commit confere de novo.
 */
async function contextoReserva(
  deps: ProcessDeps,
  ctx: Ctx,
  itens: readonly ItemExtraido[],
  s1: ContextoS1,
  avisos: Atendimento['avisos'],
  now: Date,
  resposta: RespostaDaReserva,
): Promise<ContextoReserva> {
  const vagas = new Map<string, ReadonlyMap<string, VagasUnidade>>()
  for (const dia of diasDaReserva(itens, s1, now, avisos)) {
    vagas.set(dia, await ocupacaoDoDia(deps.db, ctx.restaurant.id, dia, ctx.conv.simulada))
  }
  return {
    vagas, regras: ctx.restaurant.regrasReserva, pergunta: resposta.pergunta ?? null, ...(resposta.numero ? { numero: resposta.numero } : {}),
  }
}

/** Cifra o contato informado (o número em claro não sai daqui) e prepara as respostas do commit para a reserva. */
function acaoDoWorker(a: AcaoS2, phoneKey: Buffer, s1: ContextoS1, now: Date): AcaoReserva {
  if (a.tipo !== 'registrar') return a
  const { contato, ...resto } = a
  const contatoCifrado = contato === 'manter' ? undefined : contato === 'whatsapp' ? null : encryptPhone(contato.numero, phoneKey)
  const unidade = s1.unidades.find((u) => u.id === a.unitId)?.nome ?? null
  const item = { ...ITEM_RESERVA, unidade, data: a.data, pessoas: a.pessoas, horario: a.horario, nome: a.nome }
  const seLotado: ReservaGravada = {
    tipo: 'reserva', campo: 'lotado', pergunta: '', perguntaEnviada: a.textoSeLotado.slice(0, MAX_PERGUNTA_ENVIADA), item, unitId: null,
    tentativasNumero: 0, expiraEm: new Date(now.getTime() + PENDENTE_MIN * 60_000).toISOString(),
  }
  return { ...resto, contatoCifrado, seLotado, textoSeIndisponivel: renderModelo('reserva_indisponivel', {}, s1.modelos) }
}

/**
 * Unidade de contexto da conversa (`unidade_contexto_id`, visibilidade na inbox): a escolhida na lista, a dos pendentes
 * (reserva, evento), a das ações (reserva, pedido de evento, cardápio) ou a citada num item — sempre uma unidade ativa.
 * Restaurante de uma unidade só: a dela, se algo foi atendido. Nenhuma ⇒ mantém a anterior.
 */
function unidadeDaResposta(
  r: ResultadoAtendimento,
  itens: readonly ItemExtraido[],
  unidades: readonly UnidadeS1[],
  escolhidaId: string | undefined,
): string | undefined {
  const ativas = new Set(unidades.map((u) => u.id))
  const candidatas = [
    escolhidaId,
    r.perguntarReserva?.unitId,
    r.perguntarEvento?.unitId,
    r.perguntaEventoAdiada?.unitId,
    ...r.acoesS2.map((a) => (a.tipo === 'cancelar' ? null : a.unitId)),
    ...r.acoesS3.map((a) => (a.tipo === 'registrar_evento' ? a.unitId : null)),
    ...r.acoesS4.map((a) => a.unitId),
    ...itens.map((i) => encontrarUnidade(i.unidade, unidades)?.id),
  ]
  const achada = candidatas.find((id): id is string => !!id && ativas.has(id))
  if (achada) return achada
  return unidades.length === 1 && r.validos > 0 ? unidades[0]!.id : undefined
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
  // o nome guardado não vai ao modelo (a continuação o recupera do pendente)
  if (p.tipo === 'reserva') return { pergunta: p.perguntaEnviada, conhecido: conhecidoDe(p.item, true) }
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
    if (!idLista) return null
    // toque numa lista antiga durante a coleta do evento: a unidade tocada passa a ser a do pedido (pendência 3)
    if (lidoPendente?.tipo === 'pedido_evento' && new Date(lidoPendente.expiraEm) > now) {
      const doEvento = await escolhaParaPedidoEvento(deps, ctx, lidoPendente, idLista, now)
      if (doEvento) return doEvento
    }
    // toque numa lista que já não vale: avisa sem gastar o modelo
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
  const a = await atender(deps, ctx, atendimento, p.itens.map(semContatoOk), now, escolhida.id)
  const run: AiRunRow = {
    etapa: 'resposta', modelo: 'deterministico', promptVersion: 's1-lista', costUsd: '0', intent: 'escolha_unidade', resultado: 'ok',
  }
  // o pendente da decisão vale: a reserva escolhida passa a esperar o próximo campo; a pergunta do evento escondida
  // pela lista sai agora (pendência 2)
  return { ...decisaoDe(a, now, p.pergunta, p.eventoAdiado), runs: [run] }
}

type PendentePedidoEvento = Extract<Pendente, { tipo: 'pedido_evento' }>

/** Id tocado numa lista antiga com o pedido de evento em coleta: resolve o pedido na unidade tocada (se ativa). */
async function escolhaParaPedidoEvento(
  deps: ProcessDeps,
  ctx: Ctx,
  p: PendentePedidoEvento,
  idLista: string,
  now: Date,
): Promise<Decision | null> {
  const atendimento = await carregarAtendimento(deps, ctx, now)
  const unidade = atendimento.s1.unidades.find((u) => u.id === idLista)
  if (!unidade) return null
  const item = itemDoPedidoNaUnidade({ campo: p.campo, item: p.item, unitId: p.unitId }, unidade)
  const a = await atender(deps, ctx, atendimento, [item], now, unidade.id)
  const run: AiRunRow = {
    etapa: 'resposta', modelo: 'deterministico', promptVersion: 's1-lista', costUsd: '0', intent: 'escolha_unidade_evento', resultado: 'ok',
  }
  return { ...decisaoDe(a, now, ''), runs: [run] }
}

const ITEM_RESERVA: ItemExtraido = {
  servico: 'aviso_presenca', tipo: 'registrar', unidade: null, data: null, tema: null, pessoas: null, horario: null, convidados: null,
  tipoEvento: null, espaco: null, consulta: null, tag: null, nome: null, contato_ok: null,
}
/** `contato_ok` só vale respondendo à pergunta de contato (o core também confere): fora dela, o modelo não decide. */
const semContatoOk = (i: ItemExtraido): ItemExtraido => (i.servico === 'aviso_presenca' ? { ...i, contato_ok: null } : i)

const perguntaDoPendente = (p: PendenteReserva): PerguntaReserva =>
  ({ campo: p.campo, item: p.item, unitId: p.unitId, tentativasNumero: p.tentativasNumero })

/** Telefone do próprio WhatsApp do cliente em E.164 (null no simulador ou se a cifra não abrir). Nunca vai a log. */
function telefoneDoCliente(ctx: Ctx, phoneKey: Buffer): string | null {
  try {
    return `+${normalizeWaId(decryptPhone(ctx.customer.telefoneCifrado, phoneKey))}`
  } catch {
    return null
  }
}

/**
 * Pergunta de contato pendente: o número vem do texto **bruto** (antes da redação; o modelo só vê [TELEFONE]). Um número
 * válido responde também ao "Posso usar este WhatsApp?" ("não, usa o 61 9…") sem pedir de novo; o do próprio WhatsApp
 * vale como "sim". `contatoOk` substitui o que o modelo disse.
 */
type Contato = RespostaDaReserva & { pergunta: PerguntaReserva; contatoOk?: boolean; capturou: boolean }
function contatoDaResposta(p: PendenteReserva, textoBruto: string, proprio: () => string | null): Contato {
  const pergunta = perguntaDoPendente(p)
  if (p.campo !== 'contato' && p.campo !== 'contato_numero') return { pergunta, capturou: false }
  const valor = capturarTelefone(textoBruto)
  const tentativas = p.campo === 'contato_numero' ? p.tentativasNumero : 0
  // o telefone do cliente só é decifrado aqui, com a pergunta de contato e um número na resposta
  if (valor && valor === proprio()) return { pergunta: { ...pergunta, campo: 'contato' }, contatoOk: true, capturou: true }
  if (valor) {
    return {
      pergunta: { ...pergunta, campo: 'contato_numero', item: { ...p.item, contato_ok: false } },
      numero: { valor, tentativas }, contatoOk: false, capturou: true,
    }
  }
  return p.campo === 'contato_numero' ? { pergunta, numero: { valor: null, tentativas }, capturou: false } : { pergunta, capturou: false }
}

/**
 * Continua a reserva pendente com o primeiro item de reserva da mensagem (`continuarReserva`: o que o cliente disse
 * agora vale, o resto vem do guardado). Sem pendente, nenhum item traz `contato_ok`. A unidade guardada vale pelo id
 * quando a mensagem só responde à pergunta (não reabre a lista nem confunde nomes).
 */
function continuarDoPendente(
  itens: readonly ItemExtraido[],
  p: PendenteReserva | null,
  contato: Contato | null,
): { itens: ItemExtraido[]; escolhidaId: string | undefined } {
  const limpos = itens.map(semContatoOk)
  const i = itens.findIndex((x) => x.servico === 'aviso_presenca' && x.tipo !== 'cancelar')
  if (!p || !contato || i < 0) return { itens: limpos, escolhidaId: undefined }
  const novo = contato.contatoOk === undefined ? itens[i]! : { ...itens[i]!, contato_ok: contato.contatoOk }
  limpos[i] = continuarReserva(contato.pergunta, novo)
  const soResposta = itens.length === 1 && !itens[i]!.unidade && p.unitId !== null
  return { itens: limpos, escolhidaId: soResposta ? p.unitId! : undefined }
}

// respostas curtas sem o modelo (normalizadas): sim/não ao "Posso usar este WhatsApp?"
const CONTATO_SIM = new Set([
  'sim', 's', 'pode', 'pode sim', 'sim pode', 'pode ser', 'pode usar', 'sim pode usar', 'pode usar sim', 'claro', 'sim claro',
  'isso', 'esse mesmo', 'este mesmo', 'sim esse mesmo', 'sim este mesmo', 'pode ser esse', 'ok', 'com certeza',
])
const CONTATO_NAO = new Set([
  'nao', 'n', 'nao pode', 'prefiro outro', 'prefiro outro numero', 'outro', 'outro numero', 'nao prefiro outro',
  'nao outro numero', 'nao quero outro', 'quero outro numero', 'nao esse nao',
])
const NAO_SABE_NUMERO = new Set(['nao sei', 'sei nao', 'nao tenho', 'nao lembro', 'nao sei o numero'])
// "20h", "às 20:30", "umas 8 da noite", "meio-dia": só o horário (sem dia, que a triagem resolve)
const HORARIO_CURTO = new RegExp(
  '^(?:(?:as|umas|pelas|la pelas|por volta das|por volta da|perto das|depois das|a partir das)\\s+)?'
  + '(?:\\d{1,2}(?:\\s*(?:h|hs|hr|hrs|hora|horas))?(?:\\s*\\d{2})?|meio dia|meia noite)'
  + '(?:\\s+(?:da noite|da tarde|da manha|horas?))?$',
)
// palavras que não são nome: "pode ser Maria", "quero cancelar" vão para a triagem
const NAO_E_NOME = new Set([
  'sim', 'nao', 'ok', 'pode', 'ser', 'quero', 'cancela', 'cancelar', 'reserva', 'reservar', 'obrigado', 'obrigada', 'valeu', 'oi',
  'ola', 'bom', 'boa', 'hoje', 'amanha', 'pessoa', 'pessoas', 'horas', 'nome', 'meu', 'minha', 'eu', 'sou', 'pra', 'para', 'com',
  'mesmo', 'mesma', 'outro', 'outra', 'numero', 'whatsapp', 'isso', 'esse', 'essa', 'sabado', 'domingo', 'segunda', 'terca',
  'quarta', 'quinta', 'sexta', 'unidade', 'tchau',
  // concordância, desistência e perguntas: "Beleza", "Esquece", "Quanto custa" não são nome
  'beleza', 'blz', 'tudo', 'bem', 'certo', 'combinado', 'perfeito', 'otimo', 'show', 'legal', 'joia', 'top', 'fechado', 'feito',
  'esquece', 'desisto', 'deixa', 'depois', 'nada', 'ninguem', 'quanto', 'qual', 'quais', 'onde', 'quando', 'como', 'porque',
  'vou', 'vamos', 'custa', 'preco', 'cardapio', 'aberto', 'fechado', 'evento', 'festa', 'restaurante', 'mesa', 'entao',
])
// data no texto: "e 15 de outubro?", "e no 12?", "pode ser 3 de novembro", "e na unidade 2?" não são pessoas
const DATA_OU_LUGAR = new RegExp(
  '\\b(?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|jan|fev|abr|jun|jul|ago|set|out|nov|dez|'
  + 'unidade|loja|filial)\\b|\\b(?:no|na|num|numa|em|ate|de|do|da)\\s+\\d',
)

/** Nomes que não são de pessoa: unidades (com apelidos) e o restaurante, normalizados. */
function nomesDeLugar(s1: ContextoS1, restaurante: string): Set<string> {
  return new Set([restaurante, ...s1.unidades.flatMap((u) => [u.nome, ...u.apelidos])].map(normalizeText).filter(Boolean))
}

/** Nome da reserva que é o nome de uma unidade ou do restaurante (o modelo confundiu): descartado, o core pergunta. */
const semNomeDeLugar = (itens: readonly ItemExtraido[], lugares: ReadonlySet<string>): ItemExtraido[] =>
  itens.map((i) => (i.servico === 'aviso_presenca' && i.nome && lugares.has(normalizeText(i.nome)) ? { ...i, nome: null } : i))

/** Resposta curta ao campo pendente, sem o modelo; null = a triagem decide (resposta ambígua ou com outro pedido). */
function respostaCurta(
  campo: PendenteReserva['campo'],
  texto: string,
  contato: Contato,
  lugares: ReadonlySet<string>,
): Partial<ItemExtraido> | null {
  const t = normalizeText(texto)
  const palavras = t ? t.split(' ').length : 0
  switch (campo) {
    case 'contato':
    case 'contato_numero':
      if (contato.capturou) return palavras <= 8 ? {} : null
      if (campo === 'contato') return CONTATO_SIM.has(t) ? { contato_ok: true } : CONTATO_NAO.has(t) ? { contato_ok: false } : null
      // tentativa de número que não é telefone ("61 1234") ou "não sei": conta como falha
      return (/\d/.test(t) && palavras <= 6) || NAO_SABE_NUMERO.has(t) ? {} : null
    case 'pessoas':
    case 'lotado': {
      // "somos 80" vai com o número real: acima de 60 o atendimento segue como pedido de evento
      if (DATA_OU_LUGAR.test(t)) return null
      const n = lerPessoas(texto, { min: 1, max: 1000 })
      return typeof n === 'number' ? { pessoas: n } : null
    }
    case 'horario': {
      // "20 30" (sem separador) é 20:30, não 20:00
      const horario = texto.trim().replace(/(?<!\d)(\d{1,2})\s+(\d{2})(?!\d)/, '$1:$2')
      return HORARIO_CURTO.test(t) && normalizarHorario(horario).hhmm ? { horario } : null
    }
    case 'nome': {
      const ok = palavras >= 1 && palavras <= 4 && /^[\p{L}\s'.-]+$/u.test(texto.trim()) && !t.split(' ').some((w) => NAO_E_NOME.has(w))
        && !lugares.has(t)
      return ok ? { nome: texto.trim() } : null
    }
    case 'data':
      return null
  }
}

/**
 * Resposta curta à reserva pendente ("4", "20h", "Carlos", "pode sim", "61 99999-8888"): segue a reserva guardada sem
 * chamar o modelo. Com a pergunta de contato, o número é capturado do texto bruto antes de qualquer outra leitura.
 */
async function respostaCurtaDaReserva(deps: ProcessDeps, ctx: Ctx, pending: Pending[], now: Date): Promise<Decision | null> {
  if (pending.length !== 1 || pending[0]!.tipo !== 'texto') return null
  const p = lerPendente(ctx.conv.pendente)
  if (p?.tipo !== 'reserva' || new Date(p.expiraEm) <= now) return null
  const texto = pending[0]!.texto ?? ''
  const contato = contatoDaResposta(p, texto, () => telefoneDoCliente(ctx, deps.phoneKey))
  const atendimento = await carregarAtendimento(deps, ctx, now)
  const curta = respostaCurta(p.campo, texto, contato, nomesDeLugar(atendimento.s1, ctx.restaurant.nome))
  if (!curta) return null
  const c = continuarDoPendente([{ ...ITEM_RESERVA, ...curta }], p, contato)
  const a = await atender(deps, ctx, atendimento, c.itens, now, c.escolhidaId, contato)
  const run: AiRunRow = {
    etapa: 'resposta', modelo: 'deterministico', promptVersion: 's2-reserva', costUsd: '0', intent: `resposta_${p.campo}`, resultado: 'ok',
  }
  // terminada a reserva, a pergunta do evento que ficou para depois sai agora (pendência 2)
  const d = decisaoDe(a, now, p.pergunta, p.eventoAdiado)
  return { ...d, runs: [run] }
}

/**
 * Com a pergunta de contato da reserva pendente, a mensagem que trouxe um número fica guardada mascarada (o número só
 * existe cifrado na reserva). Vale para todo caminho da decisão, inclusive humano no controle e sem orçamento.
 */
function mascaraDoContato(ctx: Ctx, pending: readonly Pending[], now: Date): Pick<Decision, 'mascarar'> {
  const p = lerPendente(ctx.conv.pendente)
  if (p?.tipo !== 'reserva' || (p.campo !== 'contato' && p.campo !== 'contato_numero') || new Date(p.expiraEm) <= now) return {}
  if (!pending.some((m) => m.texto && capturarTelefone(m.texto))) return {}
  const mascarar = pending.flatMap((m) => (m.texto && redactPii(m.texto) !== m.texto ? [{ id: m.id, texto: redactPii(m.texto) }] : []))
  return mascarar.length ? { mascarar } : {}
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
  const adiada = r.perguntaEventoAdiada
  // pergunta do evento escondida pela lista ou pela pergunta da reserva: vai junto do pendente (pendência 2)
  const eventoAdiado = adiada
    ? { eventoAdiado: { campo: adiada.campo, item: adiada.item, unitId: adiada.unitId, texto: adiada.texto.slice(0, MAX_PERGUNTA_ENVIADA) } }
    : {}
  // um pendente por vez: lista (inclui o pedido de evento sem unidade) > reserva (S2) > próximo campo do evento
  const pendente: PendenteGravado | null = r.handoff
    ? null
    : r.lista && r.pendente.length
      ? {
        tipo: 'unidade', pergunta, perguntaEnviada: r.lista.corpo.slice(0, MAX_PERGUNTA_ENVIADA), itens: r.pendente,
        opcoes: r.lista.opcoes.map((o) => o.id),
        // a lista que espera a unidade do pedido de evento vale o mesmo que as outras perguntas da coleta
        expiraEm: expira(r.pendente.some((i) => i.servico === 'evento') ? PENDENTE_EVENTO_MIN : PENDENTE_MIN),
        ...eventoAdiado,
      }
      // a reserva esperando o próximo campo, ou depois do lotado (a unidade da lista é o caso acima)
      : r.perguntarReserva && r.perguntarReserva.campo !== 'unidade'
        ? {
          tipo: 'reserva', campo: r.perguntarReserva.campo, pergunta, perguntaEnviada: ultimoTrecho(r.texto),
          item: r.perguntarReserva.item, unitId: r.perguntarReserva.unitId, tentativasNumero: r.perguntarReserva.tentativasNumero,
          expiraEm: expira(PENDENTE_MIN), ...eventoAdiado,
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
    // sem resposta válida conta como falha (LIMITE_FALHAS seguidas ⇒ handoff)
    falhas: saidas.length ? 'zerar' : 'incrementar',
    lacunas: r.lacunas,
    pergunta,
    contagem: { validos: r.validos, respondidos: r.respondidos },
    pendente,
    acoesS3: r.acoesS3,
    // a resposta do evento já diz que a equipe vai assumir: só fora do horário acrescenta quando a equipe volta
    ...(r.handoff ? { handoff: { motivo: 'servico', avisar: 'so_fora' } satisfies Handoff, audit: 'conversa.handoff_evento' } : {}),
  }
}

type EventoAdiado = z.infer<typeof eventoAdiadoSchema>

/**
 * Decisão do atendimento com as ações da reserva já preparadas para o commit (contato cifrado). `adiado`: a pergunta do
 * evento guardada no pendente respondido — sai agora se nada mais pergunta, senão segue guardada na próxima pergunta da
 * reserva ou da lista (a reserva pode levar várias mensagens).
 */
function decisaoDe(a: Atendido, now: Date, pergunta: string, adiado?: EventoAdiado): Decision {
  const d: Decision = { ...decisaoAtendimento(retomarPerguntaEvento(a.r, adiado), now, pergunta, a.midias), avisos: a.avisos, unidadeId: a.unidadeId }
  if (adiado && d.pendente && (d.pendente.tipo === 'reserva' || d.pendente.tipo === 'unidade') && !d.pendente.eventoAdiado) {
    d.pendente = { ...d.pendente, eventoAdiado: adiado }
  }
  return d
}

const fmt = (m: number) => (m / 1_000_000).toFixed(6)
const micros = (usd: string) => Math.round(Number(usd) * 1_000_000)
const ESTIMATE_MICROS = micros(TRIAGE_BUDGET_ESTIMATE_USD)
const RESERVE_USD = fmt(2 * ESTIMATE_MICROS)

// Custo desconhecido (null) de chamada possivelmente cobrada é contabilizado pela estimativa;
// falha sem uso reportado (502, rede) não custa nada.
function runCostMicros(r: JsonCallResult<TriageV7>): number {
  if (r.usage?.costUsd != null) return micros(r.usage.costUsd)
  const maybeBilled = r.ok || r.usage !== null
  return maybeBilled ? ESTIMATE_MICROS : 0
}


function resumoItens(t: TriageV7): string {
  if (t.itens.length === 0) return 'fora_escopo'
  return [...new Set(t.itens.map((i) => (i.tipo ? `${i.servico}:${i.tipo}` : i.servico)))].join(',')
}

function toRun(r: JsonCallResult<TriageV7>, fallbackModel: string): AiRunRow {
  return {
    etapa: 'triagem',
    modelo: r.model ?? fallbackModel,
    promptVersion: TRIAGE_V7_PROMPT_VERSION,
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
  // simulador tem limite próprio (`simulacao`): estourá-lo só põe a conversa simulada no modo econômico
  const reservation = await reserveBudget(db, {
    restaurantId: ctx.restaurant.id,
    scope: ctx.conv.simulada ? 'simulacao' : 'ia',
    amountUsd: RESERVE_USD, // cobre a chamada e a retentativa
    timeZone: ctx.restaurant.timezone,
    ref: `conversa:${ctx.conv.id}`,
    aoFalharAlerta: (err) => deps.log.error({ err, conversationId: ctx.conv.id }, 'falha ao gravar o alerta de gasto da recusa'),
  })
  if (!reservation) {
    const audit = ctx.conv.simulada ? 'orcamento.sem_saldo_simulacao' : 'orcamento.sem_saldo'
    return { replies: [], autor: 'sistema', handoff: { motivo: 'economico', avisar: 'sempre' }, audit }
  }

  // a resposta a uma pergunta nossa vai com o contexto (Decisão 3); pendente vencido não conta
  const pendenteAtual = lerPendente(ctx.conv.pendente)
  const contexto = pendenteDaTriagem(pendenteAtual, now)
  // reserva esperando resposta: o número (pergunta de contato) sai do texto bruto antes da triagem, que só vê [TELEFONE]
  const reservaPendente = contexto && pendenteAtual?.tipo === 'reserva' ? pendenteAtual : null
  const contato = reservaPendente ? contatoDaResposta(reservaPendente, text, () => telefoneDoCliente(ctx, deps.phoneKey)) : null
  let result: JsonCallResult<TriageV7>
  const runs: AiRunRow[] = []
  try {
    const call = () => triageV7(deps.llm, {
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
    // a triagem já tentou de novo: a falha do modelo passa direto para a equipe (e conta como falha)
    const handoff: Handoff = { motivo: 'falhas', avisar: 'sempre' }
    return { replies: [], autor: 'sistema', handoff, falhas: 'incrementar', audit: 'ia.falha_triagem', runs, budget }
  }

  const { itens, frustracao, fora_escopo: foraEscopo } = result.data
  if (itens.some((i) => i.servico === 'humano' || i.servico === 'lgpd')) {
    // resposta do sistema: com `ia` a entrega a cancelaria (a conversa já está aguardando humano)
    const handoff: Handoff = { motivo: frustracao ? 'frustracao' : 'pedido', avisar: 'sempre' }
    return { replies: [], autor: 'sistema', handoff, audit: 'conversa.handoff_triagem', runs, budget }
  }
  // cliente irritado com o atendimento: responde o que der e a equipe continua (sem "só consigo ajudar…")
  const frustrado = (d: Decision): Decision => ({
    ...d,
    replies: d.replies.filter((k) => k !== 'foraEscopo'),
    handoff: { motivo: 'frustracao', avisar: d.handoff ? 'so_fora' : 'sempre' },
    audit: 'conversa.handoff_frustracao',
  })
  if (itens.length === 0 && !foraEscopo && !frustracao) {
    // sem item e sem fora de escopo não é falha: agradecimento/despedida que o pré-filtro não pegou ("ok, até sábado
    // então", "abraço!") ⇒ "Por nada!"; pedido vago ("tenho uma dúvida") ⇒ `cortesia` (com o que a IA ajuda)
    if (temAgradecimentoOuDespedida(text)) return { replies: ['agradecimento'], autor: 'ia', runs, budget, pendente: null }
    return { replies: [], saidas: [await saidaDoModelo(db, ctx, 'cortesia', {})], autor: 'ia', runs, budget, pendente: null }
  }
  if (itens.length === 0) {
    const d: Decision = { replies: ['foraEscopo'], autor: 'ia', falhas: 'incrementar', runs, budget, pendente: null }
    return frustracao ? frustrado(d) : d
  }
  try {
    const atendimento = await carregarAtendimento(deps, ctx, now)
    const c = reservaPendente
      ? continuarDoPendente(itens, reservaPendente, contato)
      : completarDoPendente(itens.map(semContatoOk), contexto ? pendenteAtual : null, atendimento.s1.unidades)
    const a = await atender(deps, ctx, atendimento, c.itens, now, c.escolhidaId, contato ?? {})
    const d: Decision = { ...decisaoDe(a, now, perguntaMascarada(text), reservaPendente?.eventoAdiado), runs, budget }
    return frustracao ? frustrado(d) : d
  } catch (err) {
    await compensate(deps, reservation, spentMicros, ctx.conv.id)
    throw err
  }
}

async function commit(db: Db, ctx: Ctx, upTo: number, d: Decision, now: Date): Promise<Outcome> {
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
    // a mensagem que trouxe o número de contato fica guardada mascarada (o número só existe cifrado na reserva)
    for (const m of d.mascarar ?? []) {
      await tx.update(messages).set({ texto: m.texto }).where(and(eq(messages.id, m.id), eq(messages.conversationId, conversationId)))
    }
    if (humanOwns) {
      await tx.update(conversations).set({ processedUpToId: upTo, pendente: null }).where(eq(conversations.id, conversationId))
      return 'human_state'
    }

    // o banco pode mudar a decisão (cancelamento recusado ⇒ a equipe assume): o que vale é o daqui para baixo
    let { autor, handoff, pendente, audit } = d
    // reservas: na mesma transação da resposta, com a lotação conferida sob a trava da unidade; com humano no controle,
    // nada é gravado (acima). Auditoria sem PII (sem nome, contato, pessoas ou horário).
    let saidas = d.saidas ?? []
    const auditar = (acao: string, id: string) =>
      tx.insert(auditLog).values({ restaurantId, atorTipo: 'ia', acao, entidade: 'attendance_notice', entidadeId: id })
    for (const a of d.avisos ?? []) {
      if (a.tipo === 'registrar') {
        const r = await registrarReserva(tx, {
          restaurantId, unitId: a.unitId, customerId: ctx.customer.id, data: a.data, pessoas: a.pessoas, horario: a.horario, nome: a.nome,
          contatoCifrado: a.contatoCifrado, simulado: ctx.conv.simulada, origem: 'ia', ...(a.reservaId ? { reservaId: a.reservaId } : {}),
        })
        if (r.ok) {
          await auditar(r.atualizou ? 'reserva.atualizada' : 'reserva.registrada', r.id)
        } else if (r.motivo === 'lotado') {
          // corrida nas últimas vagas: a resposta vira a de lotado e a reserva fica guardada para a continuação
          saidas = trocarTrecho(saidas, a.texto, a.textoSeLotado)
          if (!pendente && !handoff) pendente = a.seLotado
        } else {
          // a reserva mudada foi cancelada (ou "não veio") no meio, ou o destino já tem outra: nada muda
          saidas = trocarTrecho(saidas, a.texto, a.textoSeIndisponivel)
        }
      } else {
        const ok = await cancelarAvisoDoCliente(tx, { restaurantId, customerId: ctx.customer.id, avisoId: a.avisoId })
        if (ok) await auditar('reserva.cancelada', a.avisoId)
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
        if (ok) {
          await tx.insert(auditLog).values({ restaurantId, atorTipo: 'ia', acao: 'evento.pedido_cancelado', entidade: 'event_request', entidadeId: a.pedidoId })
          continue
        }
        // confirmado pela equipe: o texto diz isso; recusado, cancelado ou não é dele: texto neutro (nunca "confirmado")
        const atual = await statusPedidoDoCliente(tx, { restaurantId, customerId: ctx.customer.id, pedidoId: a.pedidoId })
        saidas = trocarTrecho(saidas, a.texto, atual === 'confirmado' ? a.textoSeFalhar : a.textoSeAtualizado)
        // a equipe mexeu no pedido depois da leitura (ex.: confirmou): a resposta já diz que a equipe vai ajudar
        if (a.handoffSeFalhar && !handoff) {
          handoff = { motivo: 'servico', avisar: 'so_fora' }
          autor = 'sistema'
          pendente = null
          audit = 'conversa.handoff_evento'
          const aviso = await mensagemHandoff(tx, ctx, handoff, now)
          if (aviso) saidas = [...saidas, aviso]
        }
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
        autor: isNotice ? 'sistema' : autor,
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
        autor,
        tipo: s.tipo,
        texto: s.texto,
        payload: s.tipo === 'texto' ? null : s.payload,
        statusEnvio: 'pendente',
        aiRunId: lastRunId,
        replyKey: (s.tipo === 'texto' ? s.replyKey : undefined) ?? 's1',
      })
    }
    if (d.lacunas?.length && !ctx.conv.simulada) {
      await registrarLacunas(tx, { restaurantId, lacunas: d.lacunas, pergunta: d.pergunta ?? '' })
    }

    // restaurante de uma unidade só: a conversa fica nela desde a primeira resposta (inclusive handoff sem item atendido)
    const unidadeId = d.unidadeId ?? (ctx.conv.unidadeContextoId ? undefined : await unidadeUnica(tx, restaurantId))
    await tx
      .update(conversations)
      .set({
        processedUpToId: upTo,
        // `aguardando_desde` é gravado pelo trigger `marcar_aguardando` ao entrar em aguardando_humano
        ...(handoff ? { estado: 'aguardando_humano' as const, handoffMotivo: handoff.motivo } : {}),
        ...(d.falhas === 'incrementar' ? { falhasConsecutivas: sql`${conversations.falhasConsecutivas} + 1` } : {}),
        ...(d.falhas === 'zerar' ? { falhasConsecutivas: 0 } : {}),
        ...(pendente !== undefined ? { pendente } : {}),
        ...(unidadeId ? { unidadeContextoId: unidadeId } : {}),
      })
      .where(eq(conversations.id, conversationId))

    if (d.dsr) await tx.insert(dataSubjectRequests).values({ restaurantId, customerId: ctx.customer.id, tipo: d.dsr })
    if (audit) {
      await tx.insert(auditLog).values({ restaurantId, atorTipo: autor, acao: audit, entidade: 'conversation', entidadeId: conversationId })
    }
    return d.replies.length + saidas.length > 0 ? 'replied' : 'nothing'
  })
}

/** Id da única unidade ativa do restaurante; `undefined` com zero ou várias. */
async function unidadeUnica(tx: Tx, restaurantId: string): Promise<string | undefined> {
  const ativas = await tx.select({ id: units.id }).from(units)
    .where(and(eq(units.restaurantId, restaurantId), eq(units.ativo, true))).limit(2)
  return ativas.length === 1 ? ativas[0]!.id : undefined
}

/**
 * Troca um trecho do texto composto (um ou mais parágrafos inteiros, como o resumo da reserva seguido das regras); o
 * substituto aparece uma vez só.
 */
function trocarTrecho(saidas: Saida[], de: string, para: string): Saida[] {
  const alvo = de.split('\n\n')
  return saidas.map((s) => {
    if (s.tipo !== 'texto') return s
    const partes = s.texto.split('\n\n')
    const i = partes.findIndex((_, k) => alvo.every((p, j) => partes[k + j] === p))
    if (i < 0) return s
    partes.splice(i, alvo.length, para)
    const texto = partes.filter((p, k) => p !== para || partes.indexOf(para) === k).join('\n\n')
    return { ...s, texto }
  })
}
