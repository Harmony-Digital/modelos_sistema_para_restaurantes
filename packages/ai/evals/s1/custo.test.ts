import { describe, expect, it } from 'vitest'
import { TRIAGE_BUDGET_ESTIMATE_USD } from '../../src/triage.ts'
import { custoDaChamada } from './custo.ts'

describe('custoDaChamada', () => {
  const estimativa = Number(TRIAGE_BUDGET_ESTIMATE_USD)
  it('usa o custo informado', () => expect(custoDaChamada({ costUsd: '0.000123' })).toBe(0.000123))
  it('cobra a estimativa quando o custo é desconhecido ou inválido', () => {
    expect(custoDaChamada({ costUsd: null })).toBe(estimativa)
    expect(custoDaChamada(null)).toBe(estimativa)
    expect(custoDaChamada(undefined)).toBe(estimativa)
    expect(custoDaChamada({ costUsd: 'abc' })).toBe(estimativa)
  })
})
