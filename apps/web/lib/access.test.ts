import { describe, expect, it } from 'vitest'
import { resolveAccess } from './access.ts'

describe('resolveAccess', () => {
  it.each([
    [null, 'aal2', 'forbidden'],
    ['dono', 'aal1', 'mfa'],
    ['gerente', undefined, 'mfa'],
    ['dono', 'aal2', 'ok'],
    ['gerente', 'aal2', 'ok'],
    ['atendente', 'aal1', 'ok'],
  ] as const)('papel %s com %s → %s', (role, aal, expected) => {
    expect(resolveAccess(role, aal)).toBe(expected)
  })
})
