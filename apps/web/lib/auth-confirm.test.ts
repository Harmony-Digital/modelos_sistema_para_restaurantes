import { describe, expect, it, vi } from 'vitest'
import { confirmEmailLink, isInviteSession, podeDefinirSenha, safeNext } from './auth-confirm.ts'

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

const NOW = 1_800_000_000_000
const sec = (agoraMenosS: number) => NOW / 1000 - agoraMenosS

describe('isInviteSession', () => {
  it('sessão vinda do link (otp) recente é de convite', () => {
    expect(isInviteSession({ amr: [{ method: 'otp', timestamp: sec(10) }] }, NOW)).toBe(true)
  })
  it('otp de 2 h atrás não vale', () => {
    expect(isInviteSession({ amr: [{ method: 'otp', timestamp: sec(7200) }] }, NOW)).toBe(false)
  })
  it('otp sem timestamp não vale', () => {
    expect(isInviteSession({ amr: [{ method: 'otp' }] }, NOW)).toBe(false)
  })
  it('login por senha (com ou sem MFA) não é de convite', () => {
    expect(isInviteSession({ amr: [{ method: 'password', timestamp: 1 }] })).toBe(false)
    expect(isInviteSession({ amr: [{ method: 'totp' }, { method: 'password' }] })).toBe(false)
  })
  it('sem amr ou formato estranho não é de convite', () => {
    expect(isInviteSession({})).toBe(false)
    expect(isInviteSession(null)).toBe(false)
    expect(isInviteSession({ amr: 'otp' })).toBe(false)
    expect(isInviteSession({ amr: [null, 'otp'] })).toBe(false)
  })
})

describe('podeDefinirSenha', () => {
  const otp = { amr: [{ method: 'otp', timestamp: sec(10) }] }
  it.each([
    ['aal1', 'aal1', true],
    ['aal1', 'aal2', false],
    ['aal2', 'aal2', true],
  ])('otp com %s/%s → %s', (currentLevel, nextLevel, esperado) => {
    expect(podeDefinirSenha(otp, { currentLevel, nextLevel }, NOW)).toBe(esperado)
  })
  it('otp antigo nunca pode', () => {
    expect(podeDefinirSenha({ amr: [{ method: 'otp', timestamp: sec(7200) }] }, { currentLevel: 'aal1', nextLevel: 'aal1' }, NOW)).toBe(false)
  })
  it('login por senha nunca pode', () => {
    expect(podeDefinirSenha({ amr: [{ method: 'password' }] }, { currentLevel: 'aal1', nextLevel: 'aal1' })).toBe(false)
  })
})
