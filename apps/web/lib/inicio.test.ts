import { describe, expect, it } from 'vitest'
import { percentual } from './inicio'

describe('percentual', () => {
  it('sem perguntas mostra traço; arredonda', () => {
    expect(percentual(0, 0)).toBe('—')
    expect(percentual(2, 3)).toBe('67%')
    expect(percentual(5, 5)).toBe('100%')
  })
})
