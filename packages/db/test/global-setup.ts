import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import type { TestProject } from 'vitest/node'
import { baseTestUrl, comBanco, setRuntimeRolePasswords, TEMPLATE_DB, TEST_DB_PREFIX } from '../src/test-utils.ts'

const RAIZ = fileURLToPath(new URL('../../../', import.meta.url))

/**
 * Global setup do projeto `db`: um banco por processo do Vitest.
 *
 * 1. Derruba `atd_test_*` de rodadas anteriores (`with (force)`: rodada interrompida não deixa banco preso).
 * 2. `atd_test_template` recebe o esquema do banco base com pg_dump — auth/storage/realtime/extensões do
 *    Supabase vêm junto (não dá para usar `template postgres`: os serviços do Supabase ficam conectados) —
 *    e depois as migrations pendentes pelo mesmo comando de `pnpm db:migrate`.
 * 3. `atd_test_<n>` (n = 1..maxWorkers do projeto) são clonados do modelo (~0,2 s cada).
 */
export default async function setup(project: TestProject) {
  const base = baseTestUrl()
  const bancos = Math.max(1, Number(project.config.maxWorkers) || 1)
  const sql = postgres(base, { max: 1, onnotice: () => {} })
  try {
    await dropTestDbs(sql)
    await sql.unsafe(`create database ${TEMPLATE_DB}`)
    copiarEsquema(new URL(base).pathname.slice(1), TEMPLATE_DB)
    execFileSync('pnpm', ['--filter', '@atd/db', 'migrate'], {
      cwd: RAIZ,
      env: { ...process.env, DATABASE_URL: comBanco(base, TEMPLATE_DB) },
      stdio: 'pipe',
    })
    await setRuntimeRolePasswords(sql)
    for (let n = 1; n <= bancos; n++) {
      await sql.unsafe(`create database ${TEST_DB_PREFIX}${n} template ${TEMPLATE_DB}`)
    }
  } finally {
    await sql.end()
  }
  project.provide('atdTestDbs', bancos)
}

async function dropTestDbs(sql: postgres.Sql) {
  const antigos = await sql<{ datname: string }[]>`
    select datname from pg_database where datname like ${TEST_DB_PREFIX.replaceAll('_', '\\_') + '%'}`
  for (const { datname } of antigos) await sql.unsafe(`drop database if exists "${datname}" with (force)`)
}

/**
 * Copia o esquema de `origem` para `destino` (e as linhas de que as migrations dependem: o registro do
 * Drizzle e os buckets do Storage). Roda pg_dump/psql dentro do contêiner do banco do Supabase local:
 * a versão bate com o servidor e `supabase_admin` preserva os donos dos objetos (RLS fiel).
 */
function copiarEsquema(origem: string, destino: string) {
  const conteiner = `supabase_db_${projetoSupabase()}`
  const restaurar = `psql -U supabase_admin -d ${destino} -q -v ON_ERROR_STOP=1`
  const script = [
    `pg_dump -U supabase_admin -d ${origem} --schema-only --no-comments --exclude-extension=pg_cron --exclude-extension=pg_net --exclude-schema=pgboss | ${restaurar}`,
    `pg_dump -U supabase_admin -d ${origem} --data-only -t drizzle.__drizzle_migrations -t storage.buckets | ${restaurar}`,
  ].join(' && ')
  try {
    execFileSync('docker', ['exec', conteiner, 'sh', '-c', `set -o pipefail 2>/dev/null; ${script}`], { stdio: 'pipe' })
  } catch (e) {
    const err = e as { stderr?: Buffer; message: string }
    throw new Error(
      `Falha ao copiar o esquema para ${destino} no contêiner ${conteiner} (Supabase local no ar? \`pnpm db:start\`): ${err.stderr?.toString() || err.message}`,
    )
  }
}

function projetoSupabase(): string {
  const config = readFileSync(`${RAIZ}supabase/config.toml`, 'utf8')
  const id = /^project_id\s*=\s*"([^"]+)"/m.exec(config)?.[1]
  if (!id) throw new Error('project_id ausente em supabase/config.toml')
  return id
}
