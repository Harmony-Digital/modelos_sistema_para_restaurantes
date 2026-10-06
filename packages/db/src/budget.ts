import { and, asc, eq, or, sql } from 'drizzle-orm'
import { periodStarts } from '@atd/core'
import type { Db } from './client.ts'
import type { Tx } from './rls.ts'
import { budgetCounters, budgetLimits, spendLedger } from './schema/ops.ts'

export type BudgetScope = 'ia' | 'whatsapp'
export type Reservation = { restaurantId: string; scope: BudgetScope; amountUsd: string; counterIds: string[]; reservationId: number }

class NoBudget extends Error {}

const USD_RE = /^\d+(\.\d{1,6})?$/

/** Valida valor em USD (até 6 casas). `positive` exige > 0. Lança em valor inválido. */
export function assertUsd(v: string, positive: boolean): void {
  if (!USD_RE.test(v) || (positive && !/[1-9]/.test(v))) throw new Error('Valor em USD inválido')
}

/** Reserva atômica (invariante I6). Retorna null se não houver saldo ou limite configurado. */
export async function reserveBudget(
  db: Db,
  p: { restaurantId: string; scope: BudgetScope; amountUsd: string; timeZone: string; now?: Date; ref?: string },
): Promise<Reservation | null> {
  assertUsd(p.amountUsd, true)
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

      const [entry] = await tx
        .insert(spendLedger)
        .values({
          restaurantId: p.restaurantId,
          escopo: p.scope,
          tipo: 'reserva',
          valorUsd: p.amountUsd,
          ref: p.ref ?? null,
        })
        .returning({ id: spendLedger.id })
      return {
        restaurantId: p.restaurantId,
        scope: p.scope,
        amountUsd: p.amountUsd,
        counterIds,
        reservationId: entry!.id,
      }
    })
  } catch (e) {
    if (e instanceof NoBudget) return null
    throw e
  }
}

async function adjust(db: Db | Tx, r: Reservation, gastoUsd: string, tipo: 'liquidacao' | 'estorno', ref?: string) {
  // com Tx, transaction() vira savepoint
  await (db as Db).transaction(async (tx) => {
    // idempotência: o índice único parcial garante uma única baixa por reserva
    const inserted = await tx
      .insert(spendLedger)
      .values({
        restaurantId: r.restaurantId,
        escopo: r.scope,
        tipo,
        valorUsd: tipo === 'liquidacao' ? gastoUsd : r.amountUsd,
        ref: ref ?? null,
        reservaId: r.reservationId,
      })
      .onConflictDoNothing({
        target: spendLedger.reservaId,
        where: sql`tipo in ('liquidacao','estorno')`,
      })
      .returning({ id: spendLedger.id })
    if (inserted.length === 0) return // já liquidada/estornada

    for (const id of r.counterIds) {
      // um UPDATE por linha, na ordem da reserva (dia → mes): mesma ordem de lock
      await tx
        .update(budgetCounters)
        .set({
          reservado: sql`${budgetCounters.reservado} - ${r.amountUsd}::numeric`,
          gasto: sql`${budgetCounters.gasto} + ${gastoUsd}::numeric`,
        })
        .where(eq(budgetCounters.id, id))
    }
  })
}

export async function settleBudget(db: Db | Tx, r: Reservation, actualUsd: string, ref?: string) {
  assertUsd(actualUsd, false)
  return adjust(db, r, actualUsd, 'liquidacao', ref)
}

export function releaseBudget(db: Db | Tx, r: Reservation, ref?: string) {
  return adjust(db, r, '0', 'estorno', ref)
}

/**
 * Devolve as reservas ainda abertas (sem liquidação nem estorno) de um `ref` — processo que morreu entre a reserva e a
 * baixa. Os contadores são os dos períodos do momento da reserva. Idempotente (a baixa é única por reserva).
 */
export async function liberarReservasPendentes(
  db: Db | Tx,
  p: { restaurantId: string; ref: string; timeZone: string },
): Promise<number> {
  const abertas = await db
    .select({ id: spendLedger.id, escopo: spendLedger.escopo, valorUsd: spendLedger.valorUsd, createdAt: spendLedger.createdAt })
    .from(spendLedger)
    .where(and(
      eq(spendLedger.restaurantId, p.restaurantId),
      eq(spendLedger.ref, p.ref),
      eq(spendLedger.tipo, 'reserva'),
      sql`not exists (select 1 from public.spend_ledger b where b.reserva_id = ${spendLedger.id} and b.tipo in ('liquidacao', 'estorno'))`,
    ))
  let liberadas = 0
  for (const r of abertas) {
    const inicio = periodStarts(r.createdAt, p.timeZone)
    const contadores = await db
      .select({ id: budgetCounters.id })
      .from(budgetCounters)
      .where(and(
        eq(budgetCounters.restaurantId, p.restaurantId),
        eq(budgetCounters.escopo, r.escopo),
        or(
          and(eq(budgetCounters.periodo, 'dia'), eq(budgetCounters.inicioPeriodo, inicio.dia)),
          and(eq(budgetCounters.periodo, 'mes'), eq(budgetCounters.inicioPeriodo, inicio.mes)),
        ),
      ))
      .orderBy(asc(budgetCounters.periodo)) // mesma ordem de lock da reserva (dia → mes)
    await releaseBudget(db, {
      restaurantId: p.restaurantId, scope: r.escopo, amountUsd: String(r.valorUsd), counterIds: contadores.map((c) => c.id),
      reservationId: r.id,
    }, p.ref)
    liberadas++
  }
  return liberadas
}

