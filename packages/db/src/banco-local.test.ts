import { afterEach, describe, expect, it, vi } from 'vitest'
import { ehBancoLocal, podeRodarDemo } from './banco-local.ts'

afterEach(() => vi.unstubAllEnvs())

describe('ehBancoLocal', () => {
  it('aceita hosts locais', () => {
    expect(ehBancoLocal('postgresql://postgres:postgres@127.0.0.1:54322/postgres')).toBe(true)
    expect(ehBancoLocal('postgres://u:p@localhost:5432/db')).toBe(true)
    expect(ehBancoLocal('postgres://u:p@[::1]:5432/db')).toBe(true)
  })
  it('recusa remoto com "localhost" na query ou na senha', () => {
    expect(ehBancoLocal('postgres://u:p@db.x.supabase.co:5432/postgres?application_name=localhost')).toBe(false)
    expect(ehBancoLocal('postgres://u:localhost@db.x.supabase.co:5432/postgres')).toBe(false)
  })
  it('recusa URL inválida', () => {
    expect(ehBancoLocal('isto não é url')).toBe(false)
  })
  it('recusa em produção', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(ehBancoLocal('postgres://u:p@localhost:5432/db')).toBe(false)
  })
})

describe('podeRodarDemo', () => {
  const remoto = 'postgres://postgres:p@db.x.supabase.co:5432/postgres'
  it('roda no banco local sem pedido explícito', () => {
    expect(podeRodarDemo('postgresql://postgres:postgres@127.0.0.1:54322/postgres', [])).toBe(true)
  })
  it('recusa banco remoto sem --producao', () => {
    expect(podeRodarDemo(remoto, [])).toBe(false)
  })
  it('aceita banco remoto só com --producao (demo:s1:prod)', () => {
    expect(podeRodarDemo(remoto, ['--producao'])).toBe(true)
  })
  it('--producao não aceita URL inválida', () => {
    expect(podeRodarDemo('isto não é url', ['--producao'])).toBe(false)
  })
})
