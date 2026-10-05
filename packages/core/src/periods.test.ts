import { describe, expect, it } from 'vitest'
import { periodStarts } from './periods.ts'

const SP = 'America/Sao_Paulo'

describe('periodStarts', () => {
  it('23:59 em São Paulo ainda é o mesmo dia (02:59 UTC do dia seguinte)', () => {
    expect(periodStarts(new Date('2026-10-06T02:59:00Z'), SP)).toEqual({ dia: '2026-10-05', mes: '2026-10-01' })
  })
  it('meia-noite em São Paulo vira o dia', () => {
    expect(periodStarts(new Date('2026-10-06T03:00:00Z'), SP)).toEqual({ dia: '2026-10-06', mes: '2026-10-01' })
  })
  it('virada de mês no fuso', () => {
    expect(periodStarts(new Date('2026-11-01T02:30:00Z'), SP)).toEqual({ dia: '2026-10-31', mes: '2026-10-01' })
    expect(periodStarts(new Date('2026-11-01T03:00:00Z'), SP)).toEqual({ dia: '2026-11-01', mes: '2026-11-01' })
  })
})
