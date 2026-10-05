import { and, asc, eq, gte, sql } from 'drizzle-orm'
import type { Db } from './client.ts'
import type { Tx } from './rls.ts'
import { attendanceNotices } from './schema/s2.ts'

export type AvisoAtivo = { id: string; unitId: string; data: string; pessoas: number; horarioAprox: string | null }

/** Avisos ativos do cliente de `aPartirDe` (YYYY-MM-DD) em diante. Worker: filtra restaurant_id em toda consulta. */
export function avisosAtivosDoCliente(
  db: Db | Tx,
  p: { restaurantId: string; customerId: string; aPartirDe: string },
): Promise<AvisoAtivo[]> {
  return db
    .select({
      id: attendanceNotices.id, unitId: attendanceNotices.unitId, data: attendanceNotices.data,
      pessoas: attendanceNotices.pessoas, horarioAprox: attendanceNotices.horarioAprox,
    })
    .from(attendanceNotices)
    .where(and(
      eq(attendanceNotices.restaurantId, p.restaurantId),
      eq(attendanceNotices.customerId, p.customerId),
      eq(attendanceNotices.status, 'ativo'),
      gte(attendanceNotices.data, p.aPartirDe),
    ))
    .orderBy(asc(attendanceNotices.data), asc(attendanceNotices.createdAt))
}

export type GravarAviso = {
  restaurantId: string
  customerId: string
  unitId: string
  data: string
  pessoas: number
  horarioAprox: string | null
  nome: string | null
  simulado: boolean
}

/** Um aviso ativo por cliente/unidade/dia: o segundo registro atualiza (atomicamente, mesmo em corrida). */
export async function registrarAviso(tx: Tx, a: GravarAviso): Promise<{ id: string; atualizado: boolean }> {
  const [r] = await tx
    .insert(attendanceNotices)
    .values({
      restaurantId: a.restaurantId, customerId: a.customerId, unitId: a.unitId, data: a.data, pessoas: a.pessoas,
      horarioAprox: a.horarioAprox, nome: a.nome, origem: 'ia', simulado: a.simulado,
    })
    .onConflictDoUpdate({
      target: [attendanceNotices.customerId, attendanceNotices.unitId, attendanceNotices.data],
      targetWhere: sql`status = 'ativo'`,
      set: {
        pessoas: a.pessoas,
        horarioAprox: a.horarioAprox,
        nome: sql`coalesce(excluded.nome, ${attendanceNotices.nome})`,
        updatedAt: sql`now()`,
      },
    })
    // xmax <> 0 ⇒ a linha já existia (foi atualizada)
    .returning({ id: attendanceNotices.id, atualizado: sql<boolean>`(xmax <> 0)` })
  return r!
}

/** Cancela só aviso ativo do próprio cliente; `false` se não houver (outro cliente, já cancelado, inexistente). */
export async function cancelarAvisoDoCliente(
  tx: Tx,
  p: { restaurantId: string; customerId: string; avisoId: string },
): Promise<boolean> {
  const r = await tx
    .update(attendanceNotices)
    .set({ status: 'cancelado', updatedAt: sql`now()` })
    .where(and(
      eq(attendanceNotices.id, p.avisoId),
      eq(attendanceNotices.restaurantId, p.restaurantId),
      eq(attendanceNotices.customerId, p.customerId),
      eq(attendanceNotices.status, 'ativo'),
    ))
    .returning({ id: attendanceNotices.id })
  return r.length > 0
}
