import { sql } from 'drizzle-orm'
import { fromDrizzle, PgBoss } from 'pg-boss'
import type { Tx } from './rls.ts'

export const QUEUES = { process: 'conversation.process', processDlq: 'conversation.process.dlq' } as const
export const PROCESS_DELAY_SECONDS = 4
export type ProcessJob = { conversationId: string }
export type Enqueue = (tx: Tx, conversationId: string) => Promise<unknown>

export function createBoss(
  connectionString: string,
  role: 'web' | 'worker',
  onError?: (err: Error) => void,
): PgBoss {
  const boss =
    role === 'web'
      ? // Vercel (web_app): só enfileira. Sem migrations, manutenção, cron, LISTEN nem registro de instância; 1 conexão.
        new PgBoss({
          connectionString, schema: 'pgboss', max: 1,
          migrate: false, supervise: false, schedule: false, useListenNotify: false, registerInstance: false,
        })
      : new PgBoss({ connectionString, schema: 'pgboss', max: 3, createSchema: false }) // schema criado na migration 0004
  // Sem listener, 'error' derruba o processo. Nunca logar payloads.
  boss.on('error', onError ?? ((e) => process.emitWarning(`pg-boss: ${e.message}`)))
  return boss
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
