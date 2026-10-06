import { and, asc, desc, eq, gte, lt, ne, sql, type SQL } from 'drizzle-orm'
import type { Db } from './client.ts'
import { exigirPapel, falha, ok, registrarAuditoria, semPermissaoVira, type ErroPainel, type ResultadoPainel } from './painel-comum.ts'
import { withUserContext, type JwtClaims, type Tx } from './rls.ts'
import { conversations, customers, messages } from './schema/conversation.ts'
import type { conversationState, handoffMotivo, messageAuthor, messageType } from './schema/enums.ts'
import { quickReplies } from './schema/inbox.ts'
import { restaurants, staff, units } from './schema/restaurant.ts'

export type ConversationState = (typeof conversationState.enumValues)[number]
export type HandoffMotivo = (typeof handoffMotivo.enumValues)[number]
export type Autor = (typeof messageAuthor.enumValues)[number]
export type TipoMensagem = (typeof messageType.enumValues)[number]

export type AbaInbox = 'aguardando' | 'comigo' | 'ia' | 'encerradas'
export type ItemInbox = {
  id: string
  nome: string | null
  unidade: string | null
  trecho: string | null
  estado: ConversationState
  atendente: string | null
  aguardandoDesde: Date | null
  lastMessageAt: Date
  simulada: boolean
  handoffMotivo: HandoffMotivo | null
}
export type MensagemInbox = {
  id: number
  direcao: 'in' | 'out'
  autor: Autor
  atendente: string | null
  tipo: TipoMensagem
  texto: string | null
  transcrito: boolean
  payload: unknown
  statusEnvio: string | null
  createdAt: Date
}
/** `texto_invalido`: resposta vazia ou com mais de 4096 caracteres (a action valida antes com o mesmo Zod). */
export type ErroInbox = 'nao_encontrada' | 'ja_atendida' | 'transicao_invalida' | 'fora_da_janela' | 'nao_e_seu' | 'texto_invalido'
export type RespostaRapida = { id: string; titulo: string; texto: string; ordem: number; ativo: boolean }

const POR_PAGINA = 50
const TRECHO = 80
const MAX_TEXTO = 4096
const MAX_RESPOSTAS_ATIVAS = 30
const DIAS_ENCERRADAS = 30
const GESTAO = ['dono', 'gerente'] as const

// ============ Leitura (authenticated, RLS por unidade) ============

const trecho = sql<string | null>`(select left(m.texto, ${TRECHO}) from public.messages m
  where m.conversation_id = ${conversations.id} and m.texto is not null order by m.id desc limit 1)`

const colunasItem = {
  id: conversations.id,
  nome: customers.nomePerfil,
  unidade: units.nome,
  trecho,
  estado: conversations.estado,
  atendente: staff.nome,
  aguardandoDesde: conversations.aguardandoDesde,
  lastMessageAt: conversations.lastMessageAt,
  simulada: conversations.simulada,
  handoffMotivo: conversations.handoffMotivo,
}

function selecionarItens(tx: Tx) {
  return tx
    .select(colunasItem)
    .from(conversations)
    .innerJoin(customers, eq(customers.id, conversations.customerId))
    .leftJoin(units, eq(units.id, conversations.unidadeContextoId))
    .leftJoin(staff, eq(staff.userId, conversations.atendenteId))
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// cursor = [chave de ordenação como texto do Postgres (precisão de µs), id]; malformado ⇒ ignorado (primeira página)
const codificar = (chave: string, id: string) => Buffer.from(JSON.stringify([chave, id])).toString('base64url')
function decodificar(cursor: string | undefined): [string, string] | null {
  if (!cursor) return null
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'string'
      && UUID.test(v[1]) && !Number.isNaN(Date.parse(v[0]))) return [v[0], v[1]]
  } catch { /* cursor inválido */ }
  return null
}

/** Inbox por aba (50 por página). Aguardando: espera mais antiga primeiro; demais: última mensagem primeiro. */
export function listarInbox(
  db: Db,
  claims: JwtClaims,
  p: { aba: AbaInbox; unitId?: string; simulacoes?: boolean; cursor?: string },
): Promise<{ itens: ItemInbox[]; proximo: string | null }> {
  if (p.unitId !== undefined && !UUID.test(p.unitId)) return Promise.resolve({ itens: [], proximo: null })
  return withUserContext(db, claims, async (tx) => {
    const crescente = p.aba === 'aguardando'
    const col = crescente ? conversations.aguardandoDesde : conversations.lastMessageAt
    const filtros: SQL[] = []
    if (p.aba === 'aguardando') filtros.push(eq(conversations.estado, 'aguardando_humano'))
    else if (p.aba === 'ia') filtros.push(eq(conversations.estado, 'ia'))
    else if (p.aba === 'comigo') filtros.push(eq(conversations.estado, 'humano'), eq(conversations.atendenteId, claims.sub))
    else filtros.push(eq(conversations.estado, 'encerrada'), gte(conversations.lastMessageAt, sql`now() - make_interval(days => ${DIAS_ENCERRADAS})`))
    if (!p.simulacoes) filtros.push(eq(conversations.simulada, false))
    if (p.unitId) filtros.push(eq(conversations.unidadeContextoId, p.unitId))
    const cur = decodificar(p.cursor)
    if (cur) {
      filtros.push(crescente
        ? sql`(${col}, ${conversations.id}) > (${cur[0]}::timestamptz, ${cur[1]}::uuid)`
        : sql`(${col}, ${conversations.id}) < (${cur[0]}::timestamptz, ${cur[1]}::uuid)`)
    }
    const rows = await tx
      .select({ ...colunasItem, chave: sql<string>`${col}::text` })
      .from(conversations)
      .innerJoin(customers, eq(customers.id, conversations.customerId))
      .leftJoin(units, eq(units.id, conversations.unidadeContextoId))
      .leftJoin(staff, eq(staff.userId, conversations.atendenteId))
      .where(and(...filtros))
      .orderBy(...(crescente ? [asc(col), asc(conversations.id)] : [desc(col), desc(conversations.id)]))
      .limit(POR_PAGINA + 1)
    const pagina = rows.slice(0, POR_PAGINA)
    const ultimo = pagina.at(-1)
    const proximo = rows.length > POR_PAGINA && ultimo ? codificar(ultimo.chave, ultimo.id) : null
    return { itens: pagina.map(({ chave: _chave, ...item }) => item), proximo }
  })
}

/** Conversas reais aguardando atendente, visíveis ao usuário (contador da barra e do título). */
export function contarAguardando(db: Db, claims: JwtClaims): Promise<number> {
  return withUserContext(db, claims, async (tx) => {
    const [r] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(conversations)
      .where(and(eq(conversations.estado, 'aguardando_humano'), eq(conversations.simulada, false)))
    return r?.n ?? 0
  })
}

/** Conversa visível + 50 mensagens (as mais recentes antes de `antesDe`), em ordem cronológica. */
export function lerConversa(
  db: Db,
  claims: JwtClaims,
  id: string,
  p: { antesDe?: number } = {},
): Promise<{ conversa: ItemInbox & { janelaAte: Date | null; atendenteId: string | null }; mensagens: MensagemInbox[] } | null> {
  if (!UUID.test(id)) return Promise.resolve(null)
  return withUserContext(db, claims, async (tx) => {
    const [c] = await selecionarItens(tx).where(eq(conversations.id, id))
    if (!c) return null
    const [extra] = await tx
      .select({ janelaAte: conversations.windowExpiresAt, atendenteId: conversations.atendenteId })
      .from(conversations)
      .where(eq(conversations.id, id))
    const filtros = [eq(messages.conversationId, id)]
    if (p.antesDe !== undefined) filtros.push(lt(messages.id, p.antesDe))
    const ms = await tx
      .select({
        id: messages.id, direcao: messages.direcao, autor: messages.autor, atendente: staff.nome, tipo: messages.tipo,
        texto: messages.texto, transcrito: messages.transcrito, payload: messages.payload, statusEnvio: messages.statusEnvio,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .leftJoin(staff, eq(staff.userId, messages.atendenteId))
      .where(and(...filtros))
      .orderBy(desc(messages.id))
      .limit(POR_PAGINA)
    return {
      conversa: { ...c, janelaAte: extra?.janelaAte ?? null, atendenteId: extra?.atendenteId ?? null },
      mensagens: ms.reverse(),
    }
  })
}

/** Mediana (s) entre entrar em aguardando e ser assumida, hoje no fuso do restaurante, só conversas reais. */
export function tempoAteAssumirHoje(db: Db, claims: JwtClaims): Promise<number | null> {
  return withUserContext(db, claims, async (tx) => {
    const [r] = await tx.execute<{ t: number | string | null }>(sql`select app.tempo_ate_assumir_hoje() as t`)
    return r?.t === null || r?.t === undefined ? null : Number(r.t)
  })
}

// ============ Escrita (DAL como web_app, com a regra de visibilidade da RLS no WHERE) ============

type Contexto = { restaurantId: string; papel: 'dono' | 'gerente' | 'atendente'; todas: boolean; unidades: string[]; eu: string }

/** Quem é o usuário (avaliado como authenticated). Sem staff ativo ou sem MFA exigido ⇒ null (nada visível). */
async function contexto(tx: Tx, claims: JwtClaims): Promise<Contexto | null> {
  const [r] = await tx.execute<{ restaurant_id: string | null; papel: string | null; todas: boolean; unidades: string; mfa: boolean }>(sql`
    select app.my_restaurant_id() as restaurant_id, app.my_role()::text as papel, app.acesso_todas_unidades() as todas,
           app.minhas_unidades()::text as unidades, app.mfa_ok() as mfa`)
  if (!r?.restaurant_id || !r.papel || !r.mfa) return null
  const unidades = r.unidades.replace(/^\{|\}$/g, '').split(',').filter(Boolean)
  return { restaurantId: r.restaurant_id, papel: r.papel as Contexto['papel'], todas: r.todas, unidades, eu: claims.sub }
}

const gestao = (ctx: Contexto) => (GESTAO as readonly string[]).includes(ctx.papel)
const visivel = (ctx: Contexto) =>
  sql`c.restaurant_id = ${ctx.restaurantId}::uuid
      and (${ctx.todas}::boolean or c.unidade_contexto_id = any (${`{${ctx.unidades.join(',')}}`}::uuid[]))`

// o painel não tem INSERT em messages nem UPDATE nas colunas de controle: a escrita sai como web_app (padrão do
// simulador/returnToAi), sempre com a checagem de visibilidade acima; a auditoria volta a authenticated (self_insert).
const comoApp = (tx: Tx) => tx.execute(sql`set local role web_app`)
const comoUsuario = (tx: Tx) => tx.execute(sql`set local role authenticated`)

type EstadoAtual = { estado: ConversationState; atendente_id: string | null; atendente: string | null }
async function estadoAtual(tx: Tx, id: string): Promise<EstadoAtual | null> {
  const [r] = await tx.execute<EstadoAtual>(sql`
    select c.estado, c.atendente_id, s.nome as atendente
      from public.conversations c left join public.staff s on s.user_id = c.atendente_id
     where c.id = ${id}::uuid`)
  return r ?? null
}

type Falha = { ok: false; erro: ErroInbox }
const erro = (e: ErroInbox): Falha => ({ ok: false, erro: e })

/**
 * Assumir: UPDATE condicional único (sem ler-e-depois-gravar). De `ia|aguardando_humano`; de `humano` de outra
 * pessoa só dono/gerente com `forcar`. Cancela respostas pendentes da IA (I5) e audita a espera (sem PII).
 */
export function assumirConversa(
  db: Db,
  claims: JwtClaims,
  id: string,
  p: { forcar?: boolean },
): Promise<{ ok: true } | { ok: false; erro: ErroInbox; atendente?: string }> {
  if (!UUID.test(id)) return Promise.resolve(erro('nao_encontrada'))
  return withUserContext(db, claims, async (tx) => {
    const ctx = await contexto(tx, claims)
    if (!ctx) return erro('nao_encontrada')
    const forcar = !!p.forcar && gestao(ctx)
    await comoApp(tx)
    const [r] = await tx.execute<{ restaurant_id: string; aguardando_desde: string | null; simulada: boolean; estado_antes: string }>(sql`
      update public.conversations c set estado = 'humano', atendente_id = ${ctx.eu}::uuid
        from (select id, aguardando_desde, simulada, estado, atendente_id from public.conversations where id = ${id}::uuid) o
       where c.id = o.id and ${visivel(ctx)}
         and (c.estado in ('ia', 'aguardando_humano')
              or (${forcar}::boolean and c.estado = 'humano' and c.atendente_id is distinct from ${ctx.eu}::uuid))
      returning c.restaurant_id, to_jsonb(o.aguardando_desde) #>> '{}' as aguardando_desde, o.simulada, o.estado::text as estado_antes`)
    if (r) {
      await tx.execute(sql`
        update public.messages set status_envio = 'cancelado'
         where conversation_id = ${id}::uuid and direcao = 'out' and autor = 'ia' and status_envio = 'pendente'`)
      await comoUsuario(tx)
      await registrarAuditoria(tx, claims, {
        restaurantId: r.restaurant_id, acao: 'conversa.assumida', entidade: 'conversation', entidadeId: id,
        diff: { aguardandoDesde: r.aguardando_desde, simulada: r.simulada, estadoAnterior: r.estado_antes, ...(r.estado_antes === 'humano' && { forcado: true }) },
      })
      return { ok: true as const }
    }
    await comoUsuario(tx)
    const atual = await estadoAtual(tx, id)
    if (!atual) return erro('nao_encontrada')
    if (atual.estado === 'humano') {
      if (atual.atendente_id === ctx.eu) return { ok: true as const }
      return { ok: false as const, erro: 'ja_atendida' as const, ...(atual.atendente && { atendente: atual.atendente }) }
    }
    return erro('transicao_invalida')
  })
}

/**
 * Grava a resposta humana (`pendente`) para o worker entregar. Só quem assumiu, em `humano`, dentro da janela de 24 h.
 * Não enfileira: a Server Action enfileira depois do commit.
 */
export function responderConversa(
  db: Db,
  claims: JwtClaims,
  id: string,
  texto: string,
): Promise<{ ok: true; messageId: number } | Falha> {
  const t = texto.trim()
  if (t.length === 0 || t.length > MAX_TEXTO) return Promise.resolve(erro('texto_invalido'))
  if (!UUID.test(id)) return Promise.resolve(erro('nao_encontrada'))
  return withUserContext(db, claims, async (tx) => {
    const ctx = await contexto(tx, claims)
    if (!ctx) return erro('nao_encontrada')
    // trava a linha (RLS de UPDATE = visibilidade): devolver/encerrar concorrentes esperam este commit
    const [c] = await tx.execute<{ restaurant_id: string; estado: string; atendente_id: string | null; na_janela: boolean | null }>(sql`
      select c.restaurant_id, c.estado, c.atendente_id, c.window_expires_at > now() as na_janela
        from public.conversations c where c.id = ${id}::uuid for update`)
    if (!c) return erro('nao_encontrada')
    if (c.estado !== 'humano') return erro('transicao_invalida')
    if (c.atendente_id !== ctx.eu) return erro('nao_e_seu')
    if (!c.na_janela) return erro('fora_da_janela')
    await comoApp(tx)
    const [m] = await tx.execute<{ id: string | number }>(sql`
      insert into public.messages (restaurant_id, conversation_id, direcao, autor, atendente_id, tipo, texto, status_envio)
      values (${c.restaurant_id}::uuid, ${id}::uuid, 'out', 'humano', ${ctx.eu}::uuid, 'texto', ${t}, 'pendente')
      returning id`)
    await comoUsuario(tx)
    const messageId = Number(m!.id)
    await registrarAuditoria(tx, claims, {
      restaurantId: c.restaurant_id, acao: 'conversa.respondida', entidade: 'conversation', entidadeId: id, diff: { messageId },
    })
    return { ok: true as const, messageId }
  })
}

/** "Tentar de novo": mensagem humana `falhou:*` volta a `pendente` (a action reenfileira a entrega). */
export function reenviarMensagem(
  db: Db,
  claims: JwtClaims,
  messageId: number,
): Promise<{ ok: true; conversationId: string } | Falha> {
  if (!Number.isSafeInteger(messageId) || messageId <= 0) return Promise.resolve(erro('nao_encontrada'))
  return withUserContext(db, claims, async (tx) => {
    const ctx = await contexto(tx, claims)
    if (!ctx) return erro('nao_encontrada')
    const [r] = await tx.execute<{
      conversation_id: string; restaurant_id: string; autor: string; direcao: string; status_envio: string | null
      estado: string; atendente_id: string | null; na_janela: boolean | null
    }>(sql`
      select m.conversation_id, c.restaurant_id, m.autor, m.direcao, m.status_envio, c.estado, c.atendente_id,
             c.window_expires_at > now() as na_janela
        from public.messages m join public.conversations c on c.id = m.conversation_id
       where m.id = ${messageId} for update of c`)
    if (!r) return erro('nao_encontrada')
    if (r.autor !== 'humano' || r.direcao !== 'out' || !r.status_envio?.startsWith('falhou:')) return erro('transicao_invalida')
    if (r.estado !== 'humano') return erro('transicao_invalida')
    if (r.atendente_id !== ctx.eu) return erro('nao_e_seu')
    if (!r.na_janela) return erro('fora_da_janela')
    await comoApp(tx)
    const upd = await tx.execute(sql`
      update public.messages set status_envio = 'pendente'
       where id = ${messageId} and status_envio like 'falhou:%' returning id`)
    await comoUsuario(tx)
    if (upd.length === 0) return erro('transicao_invalida')
    await registrarAuditoria(tx, claims, {
      restaurantId: r.restaurant_id, acao: 'mensagem.reenviada', entidade: 'conversation', entidadeId: r.conversation_id, diff: { messageId },
    })
    return { ok: true as const, conversationId: r.conversation_id }
  })
}

/** Devolver à IA: de `aguardando_humano` (equipe) ou `humano` (quem assumiu ou dono/gerente). Zera atendente e falhas. */
export function devolverConversa(db: Db, claims: JwtClaims, id: string): Promise<{ ok: true } | Falha> {
  return transicionar(db, claims, id, {
    acao: 'conversa.devolvida_ia',
    set: sql`estado = 'ia', atendente_id = null, falhas_consecutivas = 0, handoff_motivo = null`,
    origem: sql`c.estado = 'aguardando_humano'`,
  })
}

/** Encerrar: de qualquer estado aberto (`humano` de outra pessoa só dono/gerente). A próxima mensagem abre conversa nova. */
export function encerrarConversa(db: Db, claims: JwtClaims, id: string): Promise<{ ok: true } | Falha> {
  return transicionar(db, claims, id, {
    acao: 'conversa.encerrada',
    set: sql`estado = 'encerrada', pendente = null`,
    origem: sql`c.estado in ('ia', 'aguardando_humano')`,
  })
}

/** UPDATE condicional: `origem` livre para a equipe, ou `humano` de quem assumiu / de qualquer um para a gestão. */
function transicionar(
  db: Db,
  claims: JwtClaims,
  id: string,
  t: { acao: string; set: SQL; origem: SQL },
): Promise<{ ok: true } | Falha> {
  if (!UUID.test(id)) return Promise.resolve(erro('nao_encontrada'))
  return withUserContext(db, claims, async (tx) => {
    const ctx = await contexto(tx, claims)
    if (!ctx) return erro('nao_encontrada')
    await comoApp(tx)
    const [r] = await tx.execute<{ restaurant_id: string; simulada: boolean }>(sql`
      update public.conversations c set ${t.set}
       where c.id = ${id}::uuid and ${visivel(ctx)}
         and (${t.origem} or (c.estado = 'humano' and (c.atendente_id = ${ctx.eu}::uuid or ${gestao(ctx)}::boolean)))
      returning c.restaurant_id, c.simulada`)
    await comoUsuario(tx)
    if (r) {
      await registrarAuditoria(tx, claims, {
        restaurantId: r.restaurant_id, acao: t.acao, entidade: 'conversation', entidadeId: id, diff: { simulada: r.simulada },
      })
      return { ok: true as const }
    }
    const atual = await estadoAtual(tx, id)
    if (!atual) return erro('nao_encontrada')
    if (atual.estado === 'humano') return erro('nao_e_seu')
    return erro('transicao_invalida')
  })
}

// ============ Respostas rápidas e horário de atendimento humano ============

export function listarRespostasRapidas(db: Db, claims: JwtClaims): Promise<RespostaRapida[]> {
  return withUserContext(db, claims, (tx) =>
    tx
      .select({ id: quickReplies.id, titulo: quickReplies.titulo, texto: quickReplies.texto, ordem: quickReplies.ordem, ativo: quickReplies.ativo })
      .from(quickReplies)
      .orderBy(asc(quickReplies.ordem), asc(quickReplies.titulo)),
  )
}

export type ResultadoRespostaRapida = ResultadoPainel<{ id: string }> | { ok: false; erro: 'limite' }

/** Cria (`id` nulo) ou edita. Dono/gerente. Mais de 30 ativas ⇒ `limite`. */
export function salvarRespostaRapida(
  db: Db,
  claims: JwtClaims,
  id: string | null,
  v: { titulo: string; texto: string; ordem: number; ativo: boolean },
): Promise<ResultadoRespostaRapida> {
  return semPermissaoVira<ResultadoRespostaRapida, ErroPainel>(() => withUserContext(db, claims, async (tx) => {
    if (!(await exigirPapel(tx, GESTAO))) return falha('sem_permissao')
    const [eu] = await tx.execute<{ r: string | null }>(sql`select app.my_restaurant_id() as r`)
    const restaurantId = eu?.r
    if (!restaurantId) return falha('sem_permissao')
    if (id !== null && !UUID.test(id)) return falha('nao_encontrada')
    // serializa o limite de ativas por restaurante
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`quick_replies:${restaurantId}`}, 0))`)
    if (v.ativo) {
      const [n] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(quickReplies)
        .where(and(eq(quickReplies.ativo, true), ...(id !== null ? [ne(quickReplies.id, id)] : [])))
      if ((n?.n ?? 0) >= MAX_RESPOSTAS_ATIVAS) return { ok: false as const, erro: 'limite' as const }
    }
    const diff = { titulo: v.titulo, ordem: v.ordem, ativo: v.ativo }
    if (id === null) {
      const [q] = await tx.execute<{ id: string }>(sql`
        insert into public.quick_replies (restaurant_id, titulo, texto, ordem, ativo)
        values (${restaurantId}::uuid, ${v.titulo}, ${v.texto}, ${v.ordem}, ${v.ativo}) returning id`)
      await registrarAuditoria(tx, claims, { restaurantId, acao: 'resposta_rapida.criada', entidade: 'quick_reply', entidadeId: q!.id, diff })
      return ok({ id: q!.id })
    }
    const [q] = await tx
      .update(quickReplies)
      .set({ titulo: v.titulo, texto: v.texto, ordem: v.ordem, ativo: v.ativo, updatedAt: sql`now()` })
      .where(eq(quickReplies.id, id))
      .returning({ id: quickReplies.id })
    if (!q) return falha('nao_encontrada')
    await registrarAuditoria(tx, claims, { restaurantId, acao: 'resposta_rapida.atualizada', entidade: 'quick_reply', entidadeId: id, diff })
    return ok({ id })
  }))
}

/**
 * Grava `restaurants.horario_atendimento_humano`. Só o dono (com MFA). O formato é validado pela Server Action
 * (Zod de @atd/core/conversa); aqui o jsonb vai como veio.
 */
export function salvarHorarioHumano(db: Db, claims: JwtClaims, v: Record<string, unknown>): Promise<ResultadoPainel> {
  return semPermissaoVira(() => withUserContext(db, claims, async (tx) => {
    if (!(await exigirPapel(tx, ['dono']))) return falha('sem_permissao')
    const [r] = await tx
      .update(restaurants)
      .set({ horarioAtendimentoHumano: v, updatedAt: sql`now()` })
      .where(eq(restaurants.id, sql`app.my_restaurant_id()`))
      .returning({ id: restaurants.id })
    if (!r) return falha('sem_permissao')
    await registrarAuditoria(tx, claims, { restaurantId: r.id, acao: 'horario_humano.atualizado', entidade: 'restaurant', entidadeId: r.id, diff: v })
    return ok(null)
  }))
}

