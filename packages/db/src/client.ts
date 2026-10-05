import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema/index.ts'

export type Db = PostgresJsDatabase<typeof schema>

export function createDb(url: string, opts: { pooled?: boolean; max?: number } = {}) {
  const sql = postgres(url, {
    prepare: !opts.pooled, // pooler em modo transaction não suporta prepared statements
    max: opts.max ?? (opts.pooled ? 1 : 10),
    idle_timeout: 20,
    connect_timeout: 10,
  })
  const db = drizzle({ client: sql, schema })
  return { db, sql }
}
