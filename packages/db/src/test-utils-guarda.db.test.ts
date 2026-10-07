import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { baseTestUrl, comBanco, getTestDb, resetDb, TEST_DB_PREFIX } from './test-utils.ts'

// Guarda contra zerar o banco de desenvolvimento: resetDb só apaga dados em bancos `atd_test_*`.
// O caso "banco que não é de teste" usa um banco vazio e descartável, nunca o banco de desenvolvimento.
const OUTRO = `atd_guarda_${process.pid}`
const admin = postgres(baseTestUrl(), { max: 1, onnotice: () => {} })
let outro: postgres.Sql

beforeAll(async () => {
  await admin.unsafe(`drop database if exists ${OUTRO} with (force)`)
  await admin.unsafe(`create database ${OUTRO}`)
  outro = postgres(comBanco(baseTestUrl(), OUTRO), { max: 1, onnotice: () => {} })
})

afterAll(async () => {
  await outro?.end()
  await admin.unsafe(`drop database if exists ${OUTRO} with (force)`)
  await admin.end()
})

describe('resetDb', () => {
  it('recusa zerar um banco que não é de teste (ex.: o banco de desenvolvimento)', async () => {
    await expect(resetDb(outro)).rejects.toThrow(/banco de teste/)
  })

  it('zera normalmente o banco clonado do processo', async () => {
    const { sql } = getTestDb()
    const [linha] = await sql<{ nome: string }[]>`select current_database() as nome`
    expect(linha?.nome.startsWith(TEST_DB_PREFIX)).toBe(true)
    await expect(resetDb(sql)).resolves.toBeUndefined()
  })
})
