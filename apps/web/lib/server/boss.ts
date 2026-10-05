import 'server-only'
import type { PgBoss } from 'pg-boss'
import { createBoss } from '@atd/db'
import { env } from './env.ts'

let pending: Promise<PgBoss> | undefined

export function getBoss(): Promise<PgBoss> {
  pending ??= (async () => {
    const boss = createBoss(env().DATABASE_URL, 'web')
    await boss.start()
    return boss
  })().catch((e: unknown) => {
    pending = undefined
    throw e
  })
  return pending
}
