import { and, count, eq, inArray, max, ne } from 'drizzle-orm'
import { periodStarts } from '@atd/core'
import type { Db } from './client.ts'
import { withUserContext, type JwtClaims } from './rls.ts'
import { conversations } from './schema/conversation.ts'
import { budgetCounters, workerHeartbeats } from './schema/ops.ts'
import { restaurants } from './schema/restaurant.ts'

export function getPanelStatus(db: Db, claims: JwtClaims) {
  return withUserContext(db, claims, async (tx) => {
    const [hb] = await tx.select({ last: max(workerHeartbeats.lastSeenAt) }).from(workerHeartbeats)
    const [abertas] = await tx.select({ n: count() }).from(conversations).where(ne(conversations.estado, 'encerrada'))
    const [aguardando] = await tx.select({ n: count() }).from(conversations).where(inArray(conversations.estado, ['aguardando_humano', 'humano']))
    const [r] = await tx.select({ tz: restaurants.timezone }).from(restaurants).limit(1)
    const dia = periodStarts(new Date(), r?.tz ?? 'America/Sao_Paulo').dia
    const [gasto] = await tx
      .select({ gasto: budgetCounters.gasto })
      .from(budgetCounters)
      .where(and(eq(budgetCounters.escopo, 'ia'), eq(budgetCounters.periodo, 'dia'), eq(budgetCounters.inicioPeriodo, dia)))
    return {
      workerLastSeen: hb?.last ?? null,
      conversasAbertas: abertas?.n ?? 0,
      aguardandoHumano: aguardando?.n ?? 0,
      gastoIaHojeUsd: gasto?.gasto ?? null,
    }
  })
}
