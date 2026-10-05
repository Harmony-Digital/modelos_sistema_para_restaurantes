import { randomUUID } from 'node:crypto'
import { createDb } from './client.ts'
import { restaurants, staff, units } from './schema/restaurant.ts'
import type { Db } from './client.ts'
import type postgres from 'postgres'
import { createBoss, ensureQueues } from './queue.ts'
import type { PgBoss } from 'pg-boss'

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
  await sql`delete from auth.users where email like '%@teste.local'`
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

export async function createAuthUser(sql: postgres.Sql, email: string) {
  const id = randomUUID()
  await sql`
    insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (${id}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${email}, '{}', '{}', now(), now())`
  return id
}

export async function seedStaff(
  db: Db,
  sql: postgres.Sql,
  opts: { restaurantId: string; papel: 'dono' | 'gerente' | 'atendente' },
) {
  const userId = await createAuthUser(sql, `${opts.papel}-${randomUUID()}@teste.local`)
  await db.insert(staff).values({ userId, restaurantId: opts.restaurantId, nome: opts.papel, papel: opts.papel })
  return userId
}

let bossPromise: Promise<PgBoss> | undefined
export function getTestBoss() {
  bossPromise ??= (async () => {
    const boss = createBoss(process.env.TEST_DATABASE_URL ?? DEFAULT_URL, 'worker')
    await boss.start()
    await ensureQueues(boss)
    return boss
  })()
  return bossPromise
}
