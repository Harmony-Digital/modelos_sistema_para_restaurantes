import 'server-only'
import { createDb } from '@atd/db'
import { env } from './env.ts'

let cached: ReturnType<typeof createDb> | undefined

/** Pooler Supavisor em modo transaction (Vercel): prepare desligado, 1 conexão por instância. */
export function getDb() {
  cached ??= createDb(env().DATABASE_URL, { pooled: true, max: 1 })
  return cached.db
}
