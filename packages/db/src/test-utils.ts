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

const LOCAL_HOST = '127.0.0.1:54322'
export const WORKER_URL = `postgresql://worker_app:worker_dev@${LOCAL_HOST}/postgres`
export const WEB_URL = `postgresql://web_app:web_dev@${LOCAL_HOST}/postgres`

let pgbossReady: Promise<void> | undefined
/** Fidelidade de produção: pgboss pertence a worker_app e web_app só tem os grants padrão. Só no Supabase local. */
function setupPgbossRoles(): Promise<void> {
  pgbossReady ??= (async () => {
    const url = process.env.TEST_DATABASE_URL ?? DEFAULT_URL
    if (!url.includes(LOCAL_HOST)) throw new Error('setupPgbossRoles só roda contra o Supabase local')
    const { sql } = getTestDb()
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(913)`
      await tx.unsafe(`alter role worker_app with password 'worker_dev'`)
      await tx.unsafe(`alter role web_app with password 'web_dev'`)
      const [o] = await tx<{ owner: string }[]>`
        select pg_get_userbyid(nspowner) as owner from pg_namespace where nspname = 'pgboss'`
      const [t] = await tx<{ owner: string | null }[]>`
        select (select tableowner from pg_tables where schemaname = 'pgboss' and tablename = 'job') as owner`
      if (o?.owner !== 'worker_app' || (t?.owner && t.owner !== 'worker_app')) {
        await tx.unsafe(`drop schema if exists pgboss cascade`)
        await tx.unsafe(`create schema pgboss authorization worker_app`)
        await tx.unsafe(`grant usage on schema pgboss to web_app`)
        await tx.unsafe(
          `alter default privileges for role worker_app in schema pgboss grant select, insert, update on tables to web_app`,
        )
      }
    })
  })()
  return pgbossReady
}
export { setupPgbossRoles }

let bossPromise: Promise<PgBoss> | undefined
export function getTestBoss() {
  bossPromise ??= (async () => {
    await setupPgbossRoles()
    const boss = createBoss(WORKER_URL, 'worker')
    await boss.start()
    await ensureQueues(boss)
    return boss
  })()
  return bossPromise
}
