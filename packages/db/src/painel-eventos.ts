import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { decryptPhone } from '@atd/core'
import type { Db } from './client.ts'
import { exigirPapel, falha, ok, registrarAuditoria, semPermissaoVira, type ErroPainel, type ResultadoPainel } from './painel-comum.ts'
import { withUserContext, type JwtClaims } from './rls.ts'
import { customers } from './schema/conversation.ts'
import { staff, units } from './schema/restaurant.ts'
import { eventRequests, eventSpaces, type TipoEvento } from './schema/s3.ts'
import { TELEFONE_SIMULADO } from './simulador.ts'
import type { EspacoS3 } from './eventos.ts'

const GESTAO = ['dono', 'gerente'] as const
const EQUIPE = ['dono', 'gerente', 'atendente'] as const

export type EspacoPainel = EspacoS3 & { ativo: boolean }
export type DadosEspaco = {
  unitId: string
  nome: string
  capacidadeMin: number
  capacidadeMax: number
  descricao: string | null
  condicoes: string | null
  ativo: boolean
}

/** Espaços da unidade (ativos e inativos), se a unidade for visível ao usuário. */
export function listarEspacos(db: Db, claims: JwtClaims, unitId: string): Promise<EspacoPainel[]> {
  return withUserContext(db, claims, (tx) =>
    tx
      .select({
        id: eventSpaces.id, unitId: eventSpaces.unitId, nome: eventSpaces.nome, capacidadeMin: eventSpaces.capacidadeMin,
        capacidadeMax: eventSpaces.capacidadeMax, descricao: eventSpaces.descricao, condicoes: eventSpaces.condicoes,
        ativo: eventSpaces.ativo,
      })
      .from(eventSpaces)
      .where(eq(eventSpaces.unitId, unitId))
      .orderBy(asc(eventSpaces.nome)),
  )
}

export type ResultadoSalvarEspaco = ResultadoPainel<{ id: string }> | { ok: false; erro: 'capacidade_invalida' }

/** Nome repetido na unidade ⇒ `nome_duplicado`; capacidade fora de 1 ≤ mín ≤ máx ≤ 1000 ⇒ `capacidade_invalida`. */
export function salvarEspaco(db: Db, claims: JwtClaims, id: string | null, v: DadosEspaco): Promise<ResultadoSalvarEspaco> {
  return semPermissaoVira<ResultadoPainel<{ id: string }>, ErroPainel | 'capacidade_invalida'>(
    () => withUserContext(db, claims, async (tx) => {
      if (!(await exigirPapel(tx, GESTAO))) return falha('sem_permissao')
      const [u] = await tx.select({ restaurantId: units.restaurantId }).from(units).where(eq(units.id, v.unitId))
      if (!u) return falha('nao_encontrada')
      const diff = {
        unitId: v.unitId, nome: v.nome, capacidadeMin: v.capacidadeMin, capacidadeMax: v.capacidadeMax,
        descricao: v.descricao, condicoes: v.condicoes, ativo: v.ativo,
      }
      if (id === null) {
        // a policy recusa (42501) unidade fora do acesso. SQL explícito: authenticated só tem INSERT nestas colunas (0024)
        const [e] = await tx.execute<{ id: string }>(sql`
          insert into public.event_spaces (restaurant_id, unit_id, nome, capacidade_min, capacidade_max, descricao, condicoes, ativo)
          values (${u.restaurantId}, ${v.unitId}, ${v.nome}, ${v.capacidadeMin}, ${v.capacidadeMax}, ${v.descricao}, ${v.condicoes}, ${v.ativo})
          returning id`)
        await registrarAuditoria(tx, claims, { restaurantId: u.restaurantId, acao: 'espaco.criado', entidade: 'event_space', entidadeId: e!.id, diff })
        return ok({ id: e!.id })
      }
      // o espaço não muda de unidade: unidade diferente da gravada ⇒ não encontrado
      const [e] = await tx
        .update(eventSpaces)
        .set({
          nome: v.nome, capacidadeMin: v.capacidadeMin, capacidadeMax: v.capacidadeMax, descricao: v.descricao,
          condicoes: v.condicoes, ativo: v.ativo, updatedAt: sql`now()`,
        })
        .where(and(eq(eventSpaces.id, id), eq(eventSpaces.unitId, v.unitId)))
        .returning({ id: eventSpaces.id })
      if (!e) return falha('nao_encontrada')
      await registrarAuditoria(tx, claims, { restaurantId: u.restaurantId, acao: 'espaco.atualizado', entidade: 'event_space', entidadeId: id, diff })
      return ok({ id })
    }),
    { event_spaces_unit_nome_uq: 'nome_duplicado', event_spaces_capacidade_ck: 'capacidade_invalida' },
  )
}

export type StatusPedido = 'novo' | 'em_contato' | 'confirmado' | 'recusado' | 'cancelado'
export type PedidoPainel = {
  id: string
  unitId: string
  unidade: string
  spaceId: string | null
  espaco: string | null
  nome: string | null
  data: string
  convidados: number
  tipo: TipoEvento
  tipoTexto: string | null
  observacoes: string | null
  status: StatusPedido
  responsavelId: string | null
  responsavel: string | null
  notasInternas: string | null
  temTelefone: boolean
  criadoEm: Date
}

/**
 * Fila de pedidos visíveis (RLS por unidade); simulados nunca entram. Ordem: data, depois criação.
 * Nomes das unidades vêm de uma consulta à parte: o join com `units` (estimativa ruim sob RLS) levava o
 * planejador a um nested loop por unidade em vez do índice `event_requests_fila_idx`.
 */
export function listarPedidos(
  db: Db,
  claims: JwtClaims,
  f: { status: StatusPedido[]; unitId: string | null },
): Promise<PedidoPainel[]> {
  if (f.status.length === 0) return Promise.resolve([])
  return withUserContext(db, claims, async (tx) => {
    const rows = await tx
      .select({
        id: eventRequests.id, unitId: eventRequests.unitId, spaceId: eventRequests.spaceId,
        espaco: eventSpaces.nome, nome: eventRequests.nome, data: eventRequests.data, convidados: eventRequests.convidados,
        tipo: eventRequests.tipo, tipoTexto: eventRequests.tipoTexto, observacoes: eventRequests.observacoes,
        status: eventRequests.status, responsavelId: eventRequests.responsavelId, responsavel: staff.nome,
        notasInternas: eventRequests.notasInternas, temTelefone: sql<boolean>`(${eventRequests.customerId} is not null)`,
        criadoEm: eventRequests.createdAt,
      })
      .from(eventRequests)
      .leftJoin(eventSpaces, eq(eventSpaces.id, eventRequests.spaceId))
      .leftJoin(staff, eq(staff.userId, eventRequests.responsavelId))
      .where(and(
        sql`${eventRequests.restaurantId} = (select app.my_restaurant_id())`,
        inArray(eventRequests.status, f.status),
        eq(eventRequests.simulado, false),
        f.unitId === null ? undefined : eq(eventRequests.unitId, f.unitId),
      ))
      .orderBy(asc(eventRequests.data), asc(eventRequests.createdAt), asc(eventRequests.id))
    if (rows.length === 0) return []
    const us = await tx.select({ id: units.id, nome: units.nome }).from(units)
    const nomes = new Map(us.map((u) => [u.id, u.nome]))
    return rows.map((r) => ({ ...r, unidade: nomes.get(r.unitId) ?? '' }))
  })
}

export function contarPedidosNovos(db: Db, claims: JwtClaims): Promise<number> {
  return withUserContext(db, claims, async (tx) => {
    const [r] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(eventRequests)
      .where(and(
        sql`${eventRequests.restaurantId} = (select app.my_restaurant_id())`,
        eq(eventRequests.status, 'novo'),
        eq(eventRequests.simulado, false),
      ))
    return r?.n ?? 0
  })
}

export type ResultadoAtualizarPedido = ResultadoPainel | { ok: false; erro: 'transicao_invalida' }

const TRANSICOES: Record<StatusPedido, readonly StatusPedido[]> = {
  novo: ['em_contato', 'confirmado', 'recusado', 'cancelado'],
  em_contato: ['confirmado', 'recusado', 'cancelado'],
  confirmado: ['cancelado'],
  recusado: [],
  cancelado: [],
}

/** Equipe toda (dono, gerente, atendente) muda status, responsável e notas. Notas nunca vão para a auditoria. */
export function atualizarPedido(
  db: Db,
  claims: JwtClaims,
  id: string,
  m: { status?: StatusPedido; responsavelId?: string | null; notasInternas?: string | null },
): Promise<ResultadoAtualizarPedido> {
  return semPermissaoVira(() => withUserContext(db, claims, async (tx): Promise<ResultadoAtualizarPedido> => {
    if (!(await exigirPapel(tx, EQUIPE))) return falha('sem_permissao')
    const [atual] = await tx
      .select({
        restaurantId: eventRequests.restaurantId, status: eventRequests.status,
        responsavelId: eventRequests.responsavelId, notasInternas: eventRequests.notasInternas,
      })
      .from(eventRequests)
      .where(eq(eventRequests.id, id))
      .for('update')
    if (!atual) return falha('nao_encontrada')

    const mudaStatus = m.status !== undefined && m.status !== atual.status
    if (mudaStatus && !TRANSICOES[atual.status].includes(m.status!)) {
      return { ok: false, erro: 'transicao_invalida' }
    }
    const mudaResp = m.responsavelId !== undefined && m.responsavelId !== atual.responsavelId
    if (mudaResp && m.responsavelId !== null) {
      const [membro] = await tx
        .select({ id: staff.userId })
        .from(staff)
        .where(and(eq(staff.userId, m.responsavelId!), eq(staff.ativo, true)))
      if (!membro) return falha('nao_encontrada')
    }
    const mudaNotas = m.notasInternas !== undefined && m.notasInternas !== atual.notasInternas
    if (!mudaStatus && !mudaResp && !mudaNotas) return ok(null)

    await tx
      .update(eventRequests)
      .set({
        ...(mudaStatus ? { status: m.status } : {}),
        ...(mudaResp ? { responsavelId: m.responsavelId } : {}),
        ...(mudaNotas ? { notasInternas: m.notasInternas } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(eventRequests.id, id))
    const base = { restaurantId: atual.restaurantId, entidade: 'event_request', entidadeId: id }
    if (mudaStatus) await registrarAuditoria(tx, claims, { ...base, acao: 'evento.status', diff: { de: atual.status, para: m.status } })
    if (mudaResp) await registrarAuditoria(tx, claims, { ...base, acao: 'evento.responsavel', diff: { de: atual.responsavelId, para: m.responsavelId } })
    if (mudaNotas) await registrarAuditoria(tx, claims, { ...base, acao: 'evento.notas' })
    return ok(null)
  }))
}

/**
 * Revela o telefone do cliente do pedido: só para quem vê a unidade (RLS de event_requests), auditado.
 * Nunca logar o número.
 */
export function revelarTelefonePedido(
  db: Db,
  claims: JwtClaims,
  pedidoId: string,
  phoneKey: Buffer,
): Promise<ResultadoPainel<{ telefone: string }>> {
  return withUserContext(db, claims, async (tx) => {
    const [r] = await tx
      .select({ restaurantId: eventRequests.restaurantId, cifrado: customers.telefoneCifrado })
      .from(eventRequests)
      .innerJoin(customers, eq(customers.id, eventRequests.customerId))
      .where(eq(eventRequests.id, pedidoId)) // RLS de event_requests limita à unidade visível
    if (!r || r.cifrado === TELEFONE_SIMULADO) return falha('nao_encontrada')
    const telefone = decryptPhone(r.cifrado, phoneKey)
    await registrarAuditoria(tx, claims, {
      restaurantId: r.restaurantId, acao: 'evento.telefone_visualizado', entidade: 'event_request', entidadeId: pedidoId,
    })
    return ok({ telefone })
  })
}

/** Seletor de responsável: staff ativo do restaurante. */
export function membrosDaEquipe(db: Db, claims: JwtClaims): Promise<{ id: string; nome: string }[]> {
  return withUserContext(db, claims, (tx) =>
    tx
      .select({ id: staff.userId, nome: staff.nome })
      .from(staff)
      .where(eq(staff.ativo, true))
      .orderBy(asc(staff.nome), asc(staff.userId)),
  )
}
