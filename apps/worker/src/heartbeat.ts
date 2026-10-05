import { sql } from 'drizzle-orm'
import { schema, type Db } from '@atd/db'

export function startHeartbeat(db: Db, workerId: string, versao: string, intervalMs = 15_000) {
  const beat = async () => {
    await db
      .insert(schema.workerHeartbeats)
      .values({ workerId, versao })
      .onConflictDoUpdate({ target: schema.workerHeartbeats.workerId, set: { versao, lastSeenAt: sql`now()` } })
  }
  const timer = setInterval(() => void beat().catch(() => undefined), intervalMs)
  timer.unref()
  return { beat, stop: () => clearInterval(timer) }
}
