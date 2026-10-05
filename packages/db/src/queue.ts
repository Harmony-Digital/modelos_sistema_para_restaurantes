import { sql } from 'drizzle-orm'
import { fromDrizzle, PgBoss } from 'pg-boss'
import type { Tx } from './rls.ts'

export const QUEUES = { process: 'conversation.process', processDlq: 'conversation.process.dlq' } as const
export const PROCESS_DELAY_SECONDS = 4
export type ProcessJob = { conversationId: string }
export type Enqueue = (tx: Tx, conversationId: string) => Promise<unknown>

export function createBoss(connectionString: string, role: 'web' | 'worker'): PgBoss {
  if (role === 'web') {
    // Vercel: só enfileira. Sem migrations, manutenção, cron ou LISTEN; 1 conexão.
    return new PgBoss({
      connectionString, schema: 'pgboss', max: 1,
      migrate: false, supervise: false, schedule: false, useListenNotify: false,
    })
  }
  return new PgBoss({ connectionString, schema: 'pgboss', max: 5 })
}

export async function ensureQueues(boss: PgBoss): Promise<void> {
  await boss.createQueue(QUEUES.processDlq, { policy: 'standard' })
  await boss.createQueue(QUEUES.process, {
    policy: 'stately', // 1 job enfileirado + 1 ativo por singletonKey (= conversa)
    retryLimit: 3,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 120,
    deadLetter: QUEUES.processDlq,
  })
}

export function enqueueProcess(boss: PgBoss): Enqueue {
  return (tx, conversationId) =>
    boss.send(QUEUES.process, { conversationId } satisfies ProcessJob, {
      singletonKey: conversationId,
      startAfter: PROCESS_DELAY_SECONDS,
      db: fromDrizzle(tx, sql),
    })
}
