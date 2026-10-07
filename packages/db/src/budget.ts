import { and, asc, eq, or, sql } from 'drizzle-orm'
import { periodStarts } from '@atd/core'
import type { Db } from './client.ts'
import type { Tx } from './rls.ts'
import { auditLog, budgetCounters, budgetLimits, spendLedger } from './schema/ops.ts'

/** `simulacao`: conversas do simulador têm limite próprio e nunca consomem o limite dos clientes reais. */
export type BudgetScope = 'ia' | 'simulacao' | 'whatsapp'
export type Escopo = BudgetScope
export const ESCOPOS: readonly Escopo[] = ['ia', 'simulacao', 'whatsapp']
export type NivelAlerta = 80 | 100
/** `agora`: instante da reserva (os contadores são os desse período; a liquidação confere os alertas nele). */
export type Reservation = {
  restaurantId: string; scope: BudgetScope; amountUsd: string; counterIds: string[]; reservationId: number; agora?: Date
}

class NoBudget extends Error {}

const USD_RE = /^\d+(\.\d{1,6})?$/

/** Valida valor em USD (até 6 casas). `positive` exige > 0. Lança em valor inválido. */
export function assertUsd(v: string, positive: boolean): void {
  if (!USD_RE.test(v) || (positive && !/[1-9]/.test(v))) throw new Error('Valor em USD inválido')
}

/**
 * Reserva atômica (invariante I6). Retorna null se não houver saldo ou limite configurado. Grava os alertas de gasto
 * (`registrarAlertas`) na mesma transação; na recusa, grava-os à parte (limite baixado abaixo do já gasto ⇒ 100%).
 */
export async function reserveBudget(
  db: Db,
  p: {
    restaurantId: string; scope: BudgetScope; amountUsd: string; timeZone: string; now?: Date; ref?: string
    /** falha ao gravar o alerta da recusa (ex.: deadlock): a reserva continua recusada (null); quem chama só registra */
    aoFalharAlerta?: (e: unknown) => void
  },
): Promise<Reservation | null> {
  assertUsd(p.amountUsd, true)
  const agora = p.now ?? new Date()
  const starts = periodStarts(agora, p.timeZone)
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
      await registrarAlertas(tx, { restaurantId: p.restaurantId, escopo: p.scope, agora })
      return {
        restaurantId: p.restaurantId,
        scope: p.scope,
        amountUsd: p.amountUsd,
        counterIds,
        reservationId: entry!.id,
        agora,
      }
    })
  } catch (e) {
    if (!(e instanceof NoBudget)) throw e
    // a transação da reserva foi desfeita: o alerta (ex.: 100% depois de o dono baixar o limite) vai numa só dele.
    // `recusadaUsd`: o que não coube também conta como 100% (a IA parou), mesmo com o uso entre o limiar e o limite
    try {
      await db.transaction((tx) => registrarAlertas(tx, { restaurantId: p.restaurantId, escopo: p.scope, agora, recusadaUsd: p.amountUsd }))
    } catch (err) {
      p.aoFalharAlerta?.(err)
    }
    return null
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
    // o gasto entrou nos contadores do período da reserva: confere os alertas nele, na mesma transação
    await registrarAlertas(tx, { restaurantId: r.restaurantId, escopo: r.scope, agora: r.agora ?? new Date() })
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
 * Dá baixa nas reservas ainda abertas (sem liquidação nem estorno) de um `ref` — processo que morreu entre a reserva e a
 * baixa. Sem `liquidarUsd`, devolve (estorno); com ele, liquida cada uma por esse valor (a chamada do processo morto
 * pode ter sido cobrada e o custo real não é conhecido). Os contadores são os dos períodos do momento da reserva.
 * Idempotente (a baixa é única por reserva).
 */
export async function liberarReservasPendentes(
  db: Db | Tx,
  p: { restaurantId: string; ref: string; timeZone: string; liquidarUsd?: string },
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
    const reserva: Reservation = {
      restaurantId: p.restaurantId, scope: r.escopo, amountUsd: String(r.valorUsd), counterIds: contadores.map((c) => c.id),
      reservationId: r.id, agora: r.createdAt,
    }
    if (p.liquidarUsd !== undefined) await settleBudget(db, reserva, p.liquidarUsd, p.ref)
    else await releaseBudget(db, reserva, p.ref)
    liberadas++
  }
  return liberadas
}


/**
 * Grava os alertas de gasto que o escopo cruzou nos períodos correntes (dia e mês, no fuso do restaurante — os mesmos
 * contadores de `reserveBudget`): gasto + reservado ≥ `alerta_pct`% do limite ⇒ 80; ≥ 100% ⇒ 100. Um alerta por
 * restaurante+escopo+período+início+nível (`on conflict do nothing`: concorrência e repetição não duplicam). Audita
 * `orcamento.alerta` (ator `sistema`, sem PII) para cada alerta novo e devolve os níveis novos (um por período).
 * Chamar na mesma transação da reserva/liquidação. `recusadaUsd` (só na recusa): uso + valor recusado > limite ⇒ 100.
 */
export async function registrarAlertas(
  tx: Db | Tx,
  p: { restaurantId: string; escopo: Escopo; agora: Date; recusadaUsd?: string },
): Promise<NivelAlerta[]> {
  const recusada = p.recusadaUsd ?? '0'
  assertUsd(recusada, false)
  const novos = await tx.execute<{ periodo: 'dia' | 'mes'; inicio_periodo: string; nivel: number }>(sql`
    with r as (
      select timezone as tz from public.restaurants where id = ${p.restaurantId}::uuid
    ), lim as (
      select l.periodo, l.limite_usd, l.alerta_pct,
             case l.periodo when 'dia' then (${p.agora.toISOString()}::timestamptz at time zone r.tz)::date
                            else date_trunc('month', ${p.agora.toISOString()}::timestamptz at time zone r.tz)::date end as inicio
        from public.budget_limits l cross join r
       where l.restaurant_id = ${p.restaurantId}::uuid and l.escopo = ${p.escopo}::public.budget_scope
    ), uso as (
      select lim.*, coalesce(c.gasto + c.reservado, 0) as usado
        from lim left join public.budget_counters c
          on c.restaurant_id = ${p.restaurantId}::uuid and c.escopo = ${p.escopo}::public.budget_scope
         and c.periodo = lim.periodo and c.inicio_periodo = lim.inicio
    )
    insert into public.budget_alerts (restaurant_id, escopo, periodo, inicio_periodo, nivel)
    select ${p.restaurantId}::uuid, ${p.escopo}::public.budget_scope, u.periodo, u.inicio, n.nivel
      from uso u cross join (values (80::smallint), (100::smallint)) as n(nivel)
     where (n.nivel = 80 and u.usado * 100 >= u.limite_usd * u.alerta_pct)
        or (n.nivel = 100 and (u.usado >= u.limite_usd or (${recusada}::numeric > 0 and u.usado + ${recusada}::numeric > u.limite_usd)))
     order by u.periodo, n.nivel -- ordem fixa de lock no índice único (evita deadlock entre transações)
    on conflict do nothing
    returning periodo, to_char(inicio_periodo, 'YYYY-MM-DD') as inicio_periodo, nivel`)
  for (const a of novos) {
    await tx.insert(auditLog).values({
      restaurantId: p.restaurantId,
      atorTipo: 'sistema',
      acao: 'orcamento.alerta',
      entidade: 'budget',
      entidadeId: null,
      diff: { escopo: p.escopo, periodo: a.periodo, inicioPeriodo: a.inicio_periodo, nivel: a.nivel },
    })
  }
  return novos.map((a) => a.nivel as NivelAlerta)
}
