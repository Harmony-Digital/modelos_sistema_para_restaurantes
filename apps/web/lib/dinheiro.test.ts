import { describe, expect, it } from 'vitest'
import { formatarCentavos, maskReais, reaisParaCentavos } from './dinheiro'

describe('dinheiro', () => {
  it('máscara em reais a partir dos dígitos', () => {
    expect(maskReais('')).toBe('')
    expect(maskReais('abc')).toBe('')
    expect(maskReais('5')).toBe('R$ 0,05')
    expect(maskReais('R$ 0,05' + '0')).toBe('R$ 0,50')
    expect(maskReais('123456')).toBe('R$ 1.234,56')
    expect(maskReais('123456789012')).toBe('R$ 1.234.567,89')
  })
  it('converte para centavos e volta', () => {
    expect(reaisParaCentavos('R$ 1.234,56')).toBe(123456)
    expect(reaisParaCentavos('R$ 0,00')).toBe(0)
    expect(reaisParaCentavos('')).toBeNull()
    expect(reaisParaCentavos('  ')).toBeNull()
    expect(formatarCentavos(123456)).toBe('R$ 1.234,56')
    expect(formatarCentavos(5)).toBe('R$ 0,05')
    expect(maskReais(String(4590))).toBe('R$ 45,90')
  })
})
