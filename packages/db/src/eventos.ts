import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm'
import type { Db } from './client.ts'
import type { Tx } from './rls.ts'
import { units } from './schema/restaurant.ts'
import { eventRequests, eventSpaces, type TipoEvento } from './schema/s3.ts'

export { TIPOS_EVENTO, type TipoEvento } from './schema/s3.ts'

export type EspacoS3 = {
  id: string
  unitId: string
  nome: string
  capacidadeMin: number
  capacidadeMax: number
  descricao: string | null
  condicoes: string | null
}

/** Espaços ativos de unidades ativas do restaurante. Worker: filtra restaurant_id em toda consulta. */
export function espacosAtivos(db: Db | Tx, restaurantId: string): Promise<EspacoS3[]> {
  return db
    .select({
      id: eventSpaces.id, unitId: eventSpaces.unitId, nome: eventSpaces.nome, capacidadeMin: eventSpaces.capacidadeMin,
      capacidadeMax: eventSpaces.capacidadeMax, descricao: eventSpaces.descricao, condicoes: eventSpaces.condicoes,
    })
    .from(eventSpaces)
    .innerJoin(units, and(eq(units.id, eventSpaces.unitId), eq(units.ativo, true)))
    .where(and(eq(eventSpaces.restaurantId, restaurantId), eq(eventSpaces.ativo, true)))
    .orderBy(asc(units.ordem), asc(units.nome), asc(eventSpaces.nome))
}

const ATIVOS = ['novo', 'em_contato', 'confirmado'] as const
export type PedidoAtivo = {
  id: string
  unitId: string
  /** espaço do pedido (null = sem espaço): o core compara com o espaço citado numa mudança */
  spaceId: string | null
  data: string
  convidados: number
  tipo: TipoEvento
  status: (typeof ATIVOS)[number]
}

/** Pedidos em andamento (novo/em contato/confirmado) do cliente de `aPartirDe` (YYYY-MM-DD) em diante. */
export async function pedidosDoCliente(
  db: Db | Tx,
  p: { restaurantId: string; customerId: string; aPartirDe: string },
): Promise<PedidoAtivo[]> {
  const rows = await db
    .select({
      id: eventRequests.id, unitId: eventRequests.unitId, spaceId: eventRequests.spaceId, data: eventRequests.data,
      convidados: eventRequests.convidados, tipo: eventRequests.tipo, status: eventRequests.status,
    })
    .from(eventRequests)
    .where(and(
      eq(eventRequests.restaurantId, p.restaurantId),
      eq(eventRequests.customerId, p.customerId),
      inArray(eventRequests.status, [...ATIVOS]),
      gte(eventRequests.data, p.aPartirDe),
    ))
    .orderBy(asc(eventRequests.data), asc(eventRequests.createdAt))
  return rows as PedidoAtivo[]
}

export type GravarPedido = {
  restaurantId: string
  customerId: string
  unitId: string
  spaceId: string | null
  data: string
  convidados: number
  tipo: TipoEvento
  tipoTexto: string | null
  observacoes: string | null
  nome: string | null
  simulado: boolean
}

/** Grava o pedido como `novo`: quem confirma é a equipe, nunca a IA. */
export async function registrarPedidoEvento(tx: Tx, p: GravarPedido): Promise<{ id: string }> {
  const [r] = await tx
    .insert(eventRequests)
    .values({
      restaurantId: p.restaurantId, customerId: p.customerId, unitId: p.unitId, spaceId: p.spaceId, data: p.data,
      convidados: p.convidados, tipo: p.tipo, tipoTexto: p.tipoTexto, observacoes: p.observacoes, nome: p.nome,
      simulado: p.simulado,
    })
    .returning({ id: eventRequests.id })
  return r!
}

/** Cancela só pedido do próprio cliente ainda não confirmado (novo/em contato); `false` caso contrário. */
export async function cancelarPedidoDoCliente(
  tx: Tx,
  p: { restaurantId: string; customerId: string; pedidoId: string },
): Promise<boolean> {
  const r = await tx
    .update(eventRequests)
    .set({ status: 'cancelado', updatedAt: sql`now()` })
    .where(and(
      eq(eventRequests.id, p.pedidoId),
      eq(eventRequests.restaurantId, p.restaurantId),
      eq(eventRequests.customerId, p.customerId),
      inArray(eventRequests.status, ['novo', 'em_contato']),
    ))
    .returning({ id: eventRequests.id })
  return r.length > 0
}

/** Mudança pedida pelo cliente num pedido em andamento: acrescenta a observação (texto nosso) sem passar de 300. */
export async function observarPedidoDoCliente(
  tx: Tx,
  p: { restaurantId: string; customerId: string; pedidoId: string; observacao: string },
): Promise<boolean> {
  const r = await tx
    .update(eventRequests)
    .set({
      observacoes: sql`left(concat_ws(${'\n'}, nullif(${eventRequests.observacoes}, ''), ${p.observacao}::text), 300)`,
      updatedAt: sql`now()`,
    })
    .where(and(
      eq(eventRequests.id, p.pedidoId),
      eq(eventRequests.restaurantId, p.restaurantId),
      eq(eventRequests.customerId, p.customerId),
      inArray(eventRequests.status, [...ATIVOS]),
    ))
    .returning({ id: eventRequests.id })
  return r.length > 0
}
