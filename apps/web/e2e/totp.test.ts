import { describe, expect, it } from 'vitest'
import { codigoTotp } from './totp'

// RFC 6238, apêndice B (SHA-1, segredo ASCII "12345678901234567890"), últimos 6 dígitos
const SEGREDO = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

describe('codigoTotp', () => {
  it('confere com os vetores da RFC', () => {
    expect(codigoTotp(SEGREDO, 59_000)).toBe('287082')
    expect(codigoTotp(SEGREDO, 1_111_111_109_000)).toBe('081804')
    expect(codigoTotp(SEGREDO, 1_234_567_890_000)).toBe('005924')
  })
  it('ignora espaços e minúsculas; segredo inválido falha', () => {
    expect(codigoTotp(SEGREDO.toLowerCase().replace(/(.{4})/g, '$1 '), 59_000)).toBe('287082')
    expect(() => codigoTotp('1!', 0)).toThrow('segredo TOTP inválido')
  })
})
