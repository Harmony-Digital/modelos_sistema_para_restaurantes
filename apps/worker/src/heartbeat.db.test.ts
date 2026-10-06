import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { getTestDb, resetDb } from '@atd/db/test-utils'
import { schema } from '@atd/db'
import { startHeartbeat } from './heartbeat.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
// a linha "viva" bloquearia o e2e por 90 s (a guarda dele recusa subir com outro worker no banco)
afterAll(async () => {
  await db.delete(schema.workerHeartbeats).where(eq(schema.workerHeartbeats.workerId, 'worker-teste'))
  await sql.end()
})

describe('heartbeat', () => {
  it('grava e atualiza last_seen_at', async () => {
    const hb = startHeartbeat(db, 'worker-teste', '0.1.0', 60_000)
    await hb.beat()
    const [first] = await db.select().from(schema.workerHeartbeats)
    await new Promise((r) => setTimeout(r, 20))
    await hb.beat()
    const [second] = await db.select().from(schema.workerHeartbeats)
    hb.stop()
    expect(first!.versao).toBe('0.1.0')
    expect(second!.lastSeenAt.getTime()).toBeGreaterThan(first!.lastSeenAt.getTime())
  })
})
