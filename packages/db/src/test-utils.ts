import { randomUUID } from 'node:crypto'
import { inject } from 'vitest'
import { createDb } from './client.ts'
import { restaurants, staff, units } from './schema/restaurant.ts'
import type { Db } from './client.ts'
import type postgres from 'postgres'
import { createBoss, ensureQueues } from './queue.ts'
import type { PgBoss } from 'pg-boss'

const DEFAULT_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
export const TEST_DB_PREFIX = 'atd_test_'
export const TEMPLATE_DB = `${TEST_DB_PREFIX}template`

declare module 'vitest' {
  interface ProvidedContext {
    /** Quantos bancos `atd_test_<n>` o global setup do projeto `db` clonou (0/ausente: usa o banco base). */
    atdTestDbs: number
  }
}

/** Banco base: onde o global setup cria o modelo e os clones. Fora do Vitest, é o próprio banco dos testes. */
export function baseTestUrl() {
  return process.env.TEST_DATABASE_URL ?? DEFAULT_URL
}

export function comBanco(url: string, nome: string, credenciais?: { user: string; password: string }) {
  const u = new URL(url)
  u.pathname = `/${nome}`
  if (credenciais) {
    u.username = credenciais.user
    u.password = credenciais.password
  }
  return u.toString()
}

function bancosClonados(): number {
  try {
    return inject('atdTestDbs') ?? 0
  } catch {
    return 0 // fora de um worker do Vitest (script avulso)
  }
}

/** Nome do banco deste processo: `atd_test_<VITEST_POOL_ID>` quando o global setup clonou; senão o do banco base. */
export function testDbName(): string {
  const clonados = bancosClonados()
  const pool = Number(process.env.VITEST_POOL_ID)
  if (!clonados || !pool) return new URL(baseTestUrl()).pathname.slice(1)
  if (pool > clonados) {
    throw new Error(`VITEST_POOL_ID=${pool} sem banco: o global setup clonou ${clonados} (ATD_DB_WORKERS)`)
  }
  return `${TEST_DB_PREFIX}${pool}`
}

let cached: ReturnType<typeof createDb> | undefined

export function getTestDb() {
  cached ??= createDb(comBanco(baseTestUrl(), testDbName()), { max: 20 })
  return cached
}

/**
 * Limpa o banco do processo entre testes. DELETE (não TRUNCATE): TRUNCATE troca o relfilenode de cada
 * tabela e índice e gera versões mortas em pg_class a cada teste; com o slot lógico do Analytics do
 * Supabase segurando `catalog_xmin`, o vacuum não as remove e o reset fica cada vez mais lento.
 * `session_replication_role = replica` desliga FKs/gatilhos só nesta transação, então a ordem não importa.
 * Só toca tabelas com linha — a maioria fica vazia em cada teste.
 */
export async function resetDb(sql: postgres.Sql) {
  // Guarda: nunca zerar o banco de desenvolvimento (ou qualquer banco fora dos clones do global setup).
  const [linha] = await sql<{ nome: string }[]>`select current_database() as nome`
  const nome = linha?.nome ?? ''
  if (!nome.startsWith(TEST_DB_PREFIX)) {
    throw new Error(
      `resetDb recusado: "${nome}" não é um banco de teste (${TEST_DB_PREFIX}*). Rode os testes de banco com "pnpm test:db" ou "pnpm vitest run --project db".`,
    )
  }
  await sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`
    const tabelas = await tx<{ t: string }[]>`
      select format('%I.%I', schemaname, tablename) as t
        from pg_tables
       where schemaname = 'public' or (schemaname = 'pgboss' and tablename = 'job')`
    if (!tabelas.length) return
    const comLinhas = await tx.unsafe<{ t: string }[]>(
      tabelas.map((r) => `select '${r.t.replaceAll("'", "''")}' as t where exists (select 1 from ${r.t})`).join(' union all '),
    )
    for (const { t } of comLinhas) await tx.unsafe(`delete from ${t}`)
    await tx`delete from auth.users where email like '%@teste.local'`
  })
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
const LOCAL_BASE = `postgresql://postgres:postgres@${LOCAL_HOST}/postgres`
/** Roles de runtime apontando para o mesmo banco do processo (clone do worker ou o base). */
export const WORKER_URL = comBanco(LOCAL_BASE, testDbName(), { user: 'worker_app', password: 'worker_dev' })
export const WEB_URL = comBanco(LOCAL_BASE, testDbName(), { user: 'web_app', password: 'web_dev' })

/** Senha das roles de runtime: ALTER ROLE é do cluster — o global setup roda uma vez, antes dos workers. */
export async function setRuntimeRolePasswords(sql: Pick<postgres.Sql, 'unsafe'>) {
  await sql.unsafe(`alter role worker_app with password 'worker_dev'`)
  await sql.unsafe(`alter role web_app with password 'web_dev'`)
}

let pgbossReady: Promise<void> | undefined
/** Fidelidade de produção: pgboss pertence a worker_app e web_app só tem os grants padrão. Só no Supabase local. */
function setupPgbossRoles(): Promise<void> {
  pgbossReady ??= (async () => {
    const url = baseTestUrl()
    if (!url.includes(LOCAL_HOST)) throw new Error('setupPgbossRoles só roda contra o Supabase local')
    const { sql } = getTestDb()
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(913)`
      // Com clones, o global setup já definiu as senhas; ALTER ROLE em paralelo (um por banco) colidiria.
      if (!bancosClonados()) await setRuntimeRolePasswords(tx)
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
