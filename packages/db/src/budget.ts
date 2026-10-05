import { and, eq, sql } from 'drizzle-orm'
import { periodStarts } from '@atd/core'
import type { Db } from './client.ts'
import { budgetCounters, budgetLimits, spendLedger } from './schema/ops.ts'

export type BudgetScope = 'ia' | 'whatsapp'
export type Reservation = { restaurantId: string; scope: BudgetScope; amountUsd: string; counterIds: string[] }

class NoBudget extends Error {}

/** Reserva atômica (invariante I6). Retorna null se não houver saldo ou limite configurado. */
export async function reserveBudget(
  db: Db,
  p: { restaurantId: string; scope: BudgetScope; amountUsd: string; timeZone: string; now?: Date; ref?: string },
): Promise<Reservation | null> {
  const starts = periodStarts(p.now ?? new Date(), p.timeZone)
  try {
    return await db.transaction(async (tx) => {
      const limits = await tx
        .select()
        .from(budgetLimits)
        .where(and(eq(budgetLimits.restaurantId, p.restaurantId), eq(budgetLimits.escopo, p.scope)))
        .orderBy(budgetLimits.periodo) // enum: dia < mes — ordem de lock fixa
      if (limits.length === 0) throw new NoBudget()

      const counterIds: string[] = []
      for (const lim of limits) {
        const inicio = starts[lim.periodo]
        await tx
          .insert(budgetCounters)
          .values({ restaurantId: p.restaurantId, escopo: p.scope, periodo: lim.periodo, inicioPeriodo: inicio })
          .onConflictDoNothing()
        const rows = await tx
          .update(budgetCounters)
          .set({ reservado: sql`${budgetCounters.reservado} + ${p.amountUsd}::numeric` })
          .where(
            and(
              eq(budgetCounters.restaurantId, p.restaurantId),
              eq(budgetCounters.escopo, p.scope),
              eq(budgetCounters.periodo, lim.periodo),
              eq(budgetCounters.inicioPeriodo, inicio),
              sql`${budgetCounters.gasto} + ${budgetCounters.reservado} + ${p.amountUsd}::numeric <= ${lim.limiteUsd}::numeric`,
            ),
          )
          .returning({ id: budgetCounters.id })
        if (rows.length === 0) throw new NoBudget() // desfaz reservas já feitas nesta transação
        counterIds.push(rows[0]!.id)
      }

      await tx.insert(spendLedger).values({
        restaurantId: p.restaurantId,
        escopo: p.scope,
        tipo: 'reserva',
        valorUsd: p.amountUsd,
        ref: p.ref ?? null,
      })
      return { restaurantId: p.restaurantId, scope: p.scope, amountUsd: p.amountUsd, counterIds }
    })
  } catch (e) {
    if (e instanceof NoBudget) return null
    throw e
  }
}

async function adjust(db: Db, r: Reservation, gastoUsd: string, tipo: 'liquidacao' | 'estorno', ref?: string) {
  await db.transaction(async (tx) => {
    for (const id of r.counterIds) {
      // um UPDATE por linha, na ordem da reserva (dia → mes): mesma ordem de lock
      await tx
        .update(budgetCounters)
        .set({
          reservado: sql`greatest(${budgetCounters.reservado} - ${r.amountUsd}::numeric, 0)`,
          gasto: sql`${budgetCounters.gasto} + ${gastoUsd}::numeric`,
        })
        .where(eq(budgetCounters.id, id))
    }
    await tx.insert(spendLedger).values({
      restaurantId: r.restaurantId,
      escopo: r.scope,
      tipo,
      valorUsd: tipo === 'liquidacao' ? gastoUsd : r.amountUsd,
      ref: ref ?? null,
    })
  })
}

export function settleBudget(db: Db, r: Reservation, actualUsd: string, ref?: string) {
  return adjust(db, r, actualUsd, 'liquidacao', ref)
}

export function releaseBudget(db: Db, r: Reservation, ref?: string) {
  return adjust(db, r, '0', 'estorno', ref)
}
