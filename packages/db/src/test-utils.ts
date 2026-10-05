import { createDb } from './client.ts'
import { restaurants, units } from './schema/restaurant.ts'
import type { Db } from './client.ts'
import type postgres from 'postgres'

const DEFAULT_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
let cached: ReturnType<typeof createDb> | undefined

export function getTestDb() {
  cached ??= createDb(process.env.TEST_DATABASE_URL ?? DEFAULT_URL, { max: 20 })
  return cached
}

export async function resetDb(sql: postgres.Sql) {
  const rows = await sql<{ t: string }[]>`
    select format('%I.%I', schemaname, tablename) as t
      from pg_tables where schemaname = 'public'`
  const tables = rows.map((r) => r.t)
  if (tables.length) await sql.unsafe(`truncate ${tables.join(', ')} restart identity cascade`)
  const [boss] = await sql`select to_regclass('pgboss.job') as t`
  if (boss?.t) await sql.unsafe('delete from pgboss.job')
}

export async function seedRestaurant(db: Db) {
  const [r] = await db.insert(restaurants).values({ nome: 'Restaurante Teste' }).returning({ id: restaurants.id })
  const [u] = await db
    .insert(units)
    .values({ restaurantId: r!.id, nome: 'Asa Sul', slug: 'asa-sul' })
    .returning({ id: units.id })
  return { restaurantId: r!.id, unitId: u!.id }
}
