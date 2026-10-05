import { describe, expect, it, vi } from 'vitest'
import { confirmEmailLink, safeNext } from './auth-confirm.ts'

describe('safeNext', () => {
  it.each([
    ['/definir-senha', '/definir-senha'],
    ['/unidades?x=1', '/unidades?x=1'],
    [null, '/'],
    ['', '/'],
    ['//evil.com', '/'],
    ['/\\evil.com', '/'],
    ['https://evil.com', '/'],
    ['javascript:alert(1)', '/'],
    ['/\t/evil.com', '/'],
    ['/a\\b', '/'],
    ['/%2F%2Fevil.com', '/%2F%2Fevil.com'],
  ])('%s → %s', (v, esperado) => {
    expect(safeNext(v)).toBe(esperado)
  })
})

describe('confirmEmailLink', () => {
  const url = (q: string) => new URL(`http://localhost:3000/auth/confirm?${q}`)

  it('token válido de convite vai para o next seguro', async () => {
    const verify = vi.fn(async () => ({ error: null }))
    expect(await confirmEmailLink(verify, url('token_hash=abc&type=invite&next=/definir-senha'))).toBe('/definir-senha')
    expect(verify).toHaveBeenCalledWith({ token_hash: 'abc', type: 'invite' })
  })
  it('token inválido ou expirado vai para a página de erro', async () => {
    const verify = vi.fn(async () => ({ error: new Error('expired') }))
    expect(await confirmEmailLink(verify, url('token_hash=abc&type=invite&next=/definir-senha'))).toBe('/auth/erro?motivo=link')
  })
  it('sem token ou com tipo não suportado nem chama o Supabase', async () => {
    const verify = vi.fn(async () => ({ error: null }))
    expect(await confirmEmailLink(verify, url('type=invite'))).toBe('/auth/erro?motivo=link')
    expect(await confirmEmailLink(verify, url('token_hash=abc&type=magiclink'))).toBe('/auth/erro?motivo=link')
    expect(verify).not.toHaveBeenCalled()
  })
  it('next malicioso é ignorado mesmo com token válido', async () => {
    const verify = vi.fn(async () => ({ error: null }))
    expect(await confirmEmailLink(verify, url('token_hash=abc&type=invite&next=//evil.com'))).toBe('/')
  })
})
