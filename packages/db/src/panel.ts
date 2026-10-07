import { and, count, eq, inArray, max, ne, or } from 'drizzle-orm'
import { periodStarts } from '@atd/core'
import type { Db } from './client.ts'
import { filtroSimulacao, lerModoDemonstracao } from './modo-demonstracao.ts'
import { withUserContext, type JwtClaims } from './rls.ts'
import { conversations } from './schema/conversation.ts'
import { budgetCounters, workerHeartbeats } from './schema/ops.ts'
import { restaurants } from './schema/restaurant.ts'

export function getPanelStatus(db: Db, claims: JwtClaims) {
  return withUserContext(db, claims, async (tx) => {
    const [hb] = await tx.select({ last: max(workerHeartbeats.lastSeenAt) }).from(workerHeartbeats)
    const real = filtroSimulacao(conversations.simulada, await lerModoDemonstracao(tx))
    const [abertas] = await tx.select({ n: count() }).from(conversations).where(and(real, ne(conversations.estado, 'encerrada')))
    const [aguardando] = await tx.select({ n: count() }).from(conversations).where(and(real, inArray(conversations.estado, ['aguardando_humano', 'humano'])))
    const [r] = await tx.select({ tz: restaurants.timezone }).from(restaurants).limit(1)
    const { dia, mes } = periodStarts(new Date(), r?.tz ?? 'America/Sao_Paulo')
    // RLS: só dono/gerente com MFA enxergam budget_counters; para os demais volta vazio.
    const contadores = await tx
      .select({ escopo: budgetCounters.escopo, periodo: budgetCounters.periodo, gasto: budgetCounters.gasto })
      .from(budgetCounters)
      .where(or(
        and(eq(budgetCounters.periodo, 'dia'), eq(budgetCounters.inicioPeriodo, dia)),
        and(eq(budgetCounters.periodo, 'mes'), eq(budgetCounters.inicioPeriodo, mes)),
      ))
    const gastos: Record<'ia' | 'simulacao' | 'whatsapp', { dia: string | null; mes: string | null }> = {
      ia: { dia: null, mes: null },
      simulacao: { dia: null, mes: null },
      whatsapp: { dia: null, mes: null },
    }
    for (const c of contadores) gastos[c.escopo][c.periodo] = c.gasto
    return {
      workerLastSeen: hb?.last ?? null,
      conversasAbertas: abertas?.n ?? 0,
      aguardandoHumano: aguardando?.n ?? 0,
      gastos,
    }
  })
}
