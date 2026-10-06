import { describe, expect, it } from 'vitest'
import { horarioHumanoSchema, proximoHorarioHumano, textoProximoHorario, type HorarioHumano } from './index.ts'

const TZ = 'America/Sao_Paulo'
// 2026-10-06 é terça-feira; São Paulo é UTC-3 (sem horário de verão)
const em = (local: string) => new Date(`${local}-03:00`)
const comercial: HorarioHumano = {
  dias: {
    seg: [{ inicio: '09:00', fim: '18:00' }],
    ter: [{ inicio: '09:00', fim: '12:00' }, { inicio: '14:00', fim: '18:00' }],
    qua: [{ inicio: '09:00', fim: '18:00' }],
    qui: [{ inicio: '09:00', fim: '18:00' }],
    sex: [{ inicio: '09:00', fim: '18:00' }],
  },
}
const diaUtc = (d: string) => new Date(`${d}T00:00:00Z`)

describe('horarioHumanoSchema', () => {
  it('aceita vazio e dias parciais', () => {
    expect(horarioHumanoSchema.parse({ dias: {} })).toEqual({ dias: {} })
    expect(horarioHumanoSchema.parse(comercial)).toEqual(comercial)
  })
  it('recusa hora fora do formato, dia desconhecido e mais de 4 turnos', () => {
    expect(horarioHumanoSchema.safeParse({ dias: { seg: [{ inicio: '9:00', fim: '18:00' }] } }).success).toBe(false)
    expect(horarioHumanoSchema.safeParse({ dias: { seg: [{ inicio: '24:00', fim: '18:00' }] } }).success).toBe(false)
    expect(horarioHumanoSchema.safeParse({ dias: { segunda: [] } }).success).toBe(false)
    const t = { inicio: '09:00', fim: '10:00' }
    expect(horarioHumanoSchema.safeParse({ dias: { seg: [t, t, t, t, t] } }).success).toBe(false)
  })
  it('recusa turno com início igual ao fim e turnos sobrepostos', () => {
    expect(horarioHumanoSchema.safeParse({ dias: { seg: [{ inicio: '09:00', fim: '09:00' }] } }).success).toBe(false)
    expect(horarioHumanoSchema.safeParse({ dias: { seg: [{ inicio: '09:00', fim: '12:00' }, { inicio: '11:00', fim: '14:00' }] } }).success)
      .toBe(false)
  })
})

describe('proximoHorarioHumano', () => {
  it('aberto dentro de um turno', () => {
    expect(proximoHorarioHumano(comercial, em('2026-10-06T10:00:00'), TZ)).toEqual({ aberto: true })
  })
  it('fecha no minuto exato do fim', () => {
    expect(proximoHorarioHumano(comercial, em('2026-10-06T12:00:00'), TZ))
      .toEqual({ aberto: false, proximo: { dia: diaUtc('2026-10-06'), inicio: '14:00' } })
  })
  it('fechado agora, abre hoje mais tarde', () => {
    expect(proximoHorarioHumano(comercial, em('2026-10-06T07:30:00'), TZ))
      .toEqual({ aberto: false, proximo: { dia: diaUtc('2026-10-06'), inicio: '09:00' } })
  })
  it('depois do último turno ⇒ amanhã', () => {
    expect(proximoHorarioHumano(comercial, em('2026-10-06T19:00:00'), TZ))
      .toEqual({ aberto: false, proximo: { dia: diaUtc('2026-10-07'), inicio: '09:00' } })
  })
  it('pula dias sem turno (sexta à noite ⇒ segunda)', () => {
    expect(proximoHorarioHumano(comercial, em('2026-10-09T20:00:00'), TZ))
      .toEqual({ aberto: false, proximo: { dia: diaUtc('2026-10-12'), inicio: '09:00' } })
  })
  it('usa o fuso do restaurante (23h30 de terça em SP já é quarta em UTC)', () => {
    expect(proximoHorarioHumano(comercial, new Date('2026-10-07T02:30:00Z'), TZ))
      .toEqual({ aberto: false, proximo: { dia: diaUtc('2026-10-07'), inicio: '09:00' } })
  })
  it('madrugada: turno que passa da meia-noite continua aberto no dia seguinte', () => {
    const noite: HorarioHumano = { dias: { sex: [{ inicio: '20:00', fim: '02:00' }] } }
    expect(proximoHorarioHumano(noite, em('2026-10-09T23:00:00'), TZ)).toEqual({ aberto: true })
    expect(proximoHorarioHumano(noite, em('2026-10-10T01:30:00'), TZ)).toEqual({ aberto: true })
    expect(proximoHorarioHumano(noite, em('2026-10-10T02:00:00'), TZ))
      .toEqual({ aberto: false, proximo: { dia: diaUtc('2026-10-16'), inicio: '20:00' } })
  })
  it('sem horário cadastrado ⇒ proximo null (sem promessa)', () => {
    expect(proximoHorarioHumano({ dias: {} }, em('2026-10-06T10:00:00'), TZ)).toEqual({ aberto: false, proximo: null })
    expect(proximoHorarioHumano({ dias: { seg: [] } }, em('2026-10-06T10:00:00'), TZ)).toEqual({ aberto: false, proximo: null })
  })
  it('feriado não afeta (12/10 é feriado nacional e a equipe atende normalmente)', () => {
    expect(proximoHorarioHumano(comercial, em('2026-10-12T10:00:00'), TZ)).toEqual({ aberto: true })
  })
})

describe('textoProximoHorario', () => {
  const agora = em('2026-10-06T19:00:00') // terça
  it('hoje', () => {
    expect(textoProximoHorario({ dia: diaUtc('2026-10-06'), inicio: '14:00' }, agora, TZ)).toBe('hoje a partir das 14h')
  })
  it('amanhã', () => {
    expect(textoProximoHorario({ dia: diaUtc('2026-10-07'), inicio: '09:00' }, agora, TZ)).toBe('amanhã a partir das 9h')
  })
  it('dia da semana com artigo certo', () => {
    expect(textoProximoHorario({ dia: diaUtc('2026-10-12'), inicio: '09:00' }, agora, TZ)).toBe('na segunda a partir das 9h')
    expect(textoProximoHorario({ dia: diaUtc('2026-10-10'), inicio: '10:30' }, agora, TZ)).toBe('no sábado a partir das 10h30')
    expect(textoProximoHorario({ dia: diaUtc('2026-10-11'), inicio: '13:00' }, agora, TZ)).toBe('no domingo a partir das 13h')
  })
  it('1h e meia-noite no singular', () => {
    expect(textoProximoHorario({ dia: diaUtc('2026-10-07'), inicio: '01:00' }, agora, TZ)).toBe('amanhã a partir da 1h')
    expect(textoProximoHorario({ dia: diaUtc('2026-10-07'), inicio: '00:00' }, agora, TZ)).toBe('amanhã a partir da meia-noite')
  })
  it('compõe com proximoHorarioHumano', () => {
    const agoraSexta = em('2026-10-09T20:00:00')
    const r = proximoHorarioHumano(comercial, agoraSexta, TZ)
    expect(!r.aberto && r.proximo ? textoProximoHorario(r.proximo, agoraSexta, TZ) : null).toBe('na segunda a partir das 9h')
  })
})
