import { describe, expect, it } from 'vitest'
import { avisoSchema } from './avisos'

const HOJE = '2026-10-05'
const U = '00000000-0000-4000-8000-000000000001'
const base = { unitId: U, data: '2026-10-05', pessoas: '4', horario: '', nome: '' }
const msgs = (r: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  Object.fromEntries((r.error?.issues ?? []).map((i) => [i.path.join('.'), i.message]))
const s = avisoSchema(HOJE)

describe('avisoSchema', () => {
  it('aceita hoje e hoje+30; recusa ontem e hoje+31', () => {
    expect(s.safeParse(base).success).toBe(true)
    expect(s.safeParse({ ...base, data: '2026-11-04' }).success).toBe(true)
    expect(msgs(s.safeParse({ ...base, data: '2026-10-04' }))).toEqual({ data: 'Escolha um dia de hoje até 30 dias à frente.' })
    expect(msgs(s.safeParse({ ...base, data: '2026-11-05' }))).toEqual({ data: 'Escolha um dia de hoje até 30 dias à frente.' })
  })
  it('data inexistente ou fora do formato', () => {
    expect(msgs(s.safeParse({ ...base, data: '2026-02-30' }))).toEqual({ data: 'Informe uma data válida.' })
    expect(msgs(s.safeParse({ ...base, data: '05/10/2026' }))).toEqual({ data: 'Informe uma data válida.' })
  })
  it('pessoas de 1 a 60, aceita número e texto', () => {
    for (const p of ['0', '61', '', 'abc', '2,5', 0, 61]) {
      expect(msgs(s.safeParse({ ...base, pessoas: p }))).toEqual({ pessoas: 'Informe de 1 a 60 pessoas.' })
    }
    expect(s.parse({ ...base, pessoas: '60' }).pessoas).toBe(60)
    expect(s.parse({ ...base, pessoas: 1 }).pessoas).toBe(1)
  })
  it('horário vazio ou HH:mm; nome até 60; unidade uuid', () => {
    expect(s.parse(base).horario).toBe('')
    expect(s.safeParse({ ...base, horario: '20:30' }).success).toBe(true)
    expect(msgs(s.safeParse({ ...base, horario: '25:00' }))).toEqual({ horario: 'Use o formato 24h HH:mm, como 20:00.' })
    expect(msgs(s.safeParse({ ...base, horario: '8h' }))).toEqual({ horario: 'Use o formato 24h HH:mm, como 20:00.' })
    expect(msgs(s.safeParse({ ...base, nome: 'x'.repeat(61) }))).toEqual({ nome: 'Use no máximo 60 caracteres.' })
    expect(msgs(s.safeParse({ ...base, unitId: '' }))).toEqual({ unitId: 'Escolha uma unidade.' })
  })
})
