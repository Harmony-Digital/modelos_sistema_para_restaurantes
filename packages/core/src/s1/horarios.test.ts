import { describe, expect, it } from 'vitest'
import { feriadosNacionais, mapaFeriados } from './feriados.ts'
import { estadoAgora, horarioDoDia, temHorarioCadastrado, validarSemana, validarTurnos, type AgendaUnidade, type Turno } from './horarios.ts'

const almoco = { abre: '11:30', fecha: '15:00' }
const jantar = { abre: '18:00', fecha: '23:00' }
const jantarTarde = { abre: '18:00', fecha: '02:00' }
// Asa Sul: seg fechada; ter–qui almoço+jantar; sex–sáb jantar até 2h; dom 11h30–16h
const asaSul: AgendaUnidade = {
  semanal: [[{ abre: '11:30', fecha: '16:00' }], [], [almoco, jantar], [almoco, jantar], [almoco, jantar], [almoco, jantarTarde], [almoco, jantarTarde]],
  excecoes: {},
}
const fer = mapaFeriados([...feriadosNacionais(2026), ...feriadosNacionais(2027)])

describe('horarioDoDia', () => {
  it('regra semanal', () => {
    expect(horarioDoDia(asaSul, '2026-10-06', 'como_domingo', fer)).toEqual({ turnos: [almoco, jantar], origem: 'semanal', feriado: null })
  })
  it('feriado segue a política (como_domingo / fechado / normal)', () => {
    expect(horarioDoDia(asaSul, '2026-10-12', 'como_domingo', fer)).toEqual({
      turnos: [{ abre: '11:30', fecha: '16:00' }], origem: 'feriado', feriado: 'Nossa Senhora Aparecida',
    })
    expect(horarioDoDia(asaSul, '2026-10-12', 'fechado', fer).turnos).toEqual([])
    expect(horarioDoDia(asaSul, '2026-10-12', 'normal', fer)).toEqual({ turnos: [], origem: 'semanal', feriado: 'Nossa Senhora Aparecida' })
  })
  it('exceção da data vence feriado e política', () => {
    const agenda = { ...asaSul, excecoes: { '2026-10-12': { fechado: false, turnos: [{ abre: '10:00', fecha: '14:00' }], motivo: 'Especial' } } }
    expect(horarioDoDia(agenda, '2026-10-12', 'fechado', fer)).toEqual({
      turnos: [{ abre: '10:00', fecha: '14:00' }], origem: 'excecao', feriado: 'Nossa Senhora Aparecida',
    })
    const fechada = { ...asaSul, excecoes: { '2026-10-06': { fechado: true, turnos: [], motivo: 'Reforma' } } }
    expect(horarioDoDia(fechada, '2026-10-06', 'como_domingo', fer).turnos).toEqual([])
  })
})

describe('estadoAgora', () => {
  const e = (data: string, hh: number, mm = 0) => estadoAgora(asaSul, 'como_domingo', fer, { data, minuto: hh * 60 + mm })
  it('sexta 22h30: aberta, fecha sábado às 2h', () => {
    expect(e('2026-10-09', 22, 30)).toEqual({ aberta: true, fecha: { data: '2026-10-10', hora: '02:00' } })
  })
  it('sábado 1h: ainda aberta pelo turno de sexta', () => {
    expect(e('2026-10-10', 1)).toEqual({ aberta: true, fecha: { data: '2026-10-10', hora: '02:00' } })
  })
  it('sábado 2h em ponto: fechada, abre às 11h30', () => {
    expect(e('2026-10-10', 2)).toEqual({ aberta: false, abre: { data: '2026-10-10', hora: '11:30' } })
  })
  it('domingo 10h (depois do turno de sábado até 2h): fechada, abre hoje 11h30', () => {
    expect(e('2026-10-11', 10)).toEqual({ aberta: false, abre: { data: '2026-10-11', hora: '11:30' } })
  })
  it('segunda 14h: fechada, abre terça 11h30', () => {
    expect(e('2026-10-05', 14)).toEqual({ aberta: false, abre: { data: '2026-10-06', hora: '11:30' } })
  })
  it('terça entre turnos e no minuto exato da abertura', () => {
    expect(e('2026-10-06', 15, 30)).toEqual({ aberta: false, abre: { data: '2026-10-06', hora: '18:00' } })
    expect(e('2026-10-06', 11, 30)).toEqual({ aberta: true, fecha: { data: '2026-10-06', hora: '15:00' } })
  })
  it('sem nenhum horário: fechada e sem previsão', () => {
    const vazia: AgendaUnidade = { semanal: [[], [], [], [], [], [], []], excecoes: {} }
    expect(estadoAgora(vazia, 'como_domingo', fer, { data: '2026-10-05', minuto: 600 })).toEqual({ aberta: false, abre: null })
    expect(temHorarioCadastrado(vazia)).toBe(false)
    expect(temHorarioCadastrado(asaSul)).toBe(true)
  })
})

describe('validarTurnos', () => {
  it('aceita turnos válidos, inclusive virando a meia-noite', () => {
    expect(validarTurnos([])).toBeNull()
    expect(validarTurnos([almoco, jantarTarde])).toBeNull()
    expect(validarTurnos([jantarTarde, { abre: '01:00', fecha: '03:00' }])).toBeNull()
  })
  it('rejeita formato, abertura = fechamento e sobreposição', () => {
    expect(validarTurnos([{ abre: '25:00', fecha: '23:00' }])).toBe('Turno 1: use o formato HH:MM (ex.: 11:30).')
    expect(validarTurnos([{ abre: '11:00', fecha: '11:00' }])).toBe('Turno 1: a abertura e o fechamento não podem ser iguais.')
    expect(validarTurnos([almoco, { abre: '14:00', fecha: '18:00' }])).toBe('Os turnos se sobrepõem. Ajuste os horários para não haver conflito.')
    expect(validarTurnos([jantarTarde, { abre: '20:00', fecha: '23:00' }])).toBe('Os turnos se sobrepõem. Ajuste os horários para não haver conflito.')
  })
})

describe('validarSemana', () => {
  const vazio = (): Turno[][] => [[], [], [], [], [], [], []]
  it('semana válida, inclusive com madrugada que não encosta no dia seguinte', () => {
    const s = vazio()
    s[5] = [{ abre: '18:00', fecha: '02:00' }]
    s[6] = [{ abre: '11:30', fecha: '15:00' }]
    expect(validarSemana(s)).toBeNull()
  })
  it('erro do dia (formato/sobreposição) aponta o dia', () => {
    const s = vazio()
    s[2] = [{ abre: '11:00', fecha: '11:00' }]
    expect(validarSemana(s)).toEqual({ dia: 2, erro: 'Turno 1: a abertura e o fechamento não podem ser iguais.' })
  })
  it('madrugada de sábado invade o turno de domingo', () => {
    const s = vazio()
    s[6] = [{ abre: '18:00', fecha: '03:00' }]
    s[0] = [{ abre: '02:00', fecha: '10:00' }]
    expect(validarSemana(s)).toEqual({
      dia: 6,
      erro: 'O turno de sábado vai até 03:00 do dia seguinte e encosta no turno de domingo que abre às 02:00. Ajuste um dos dois.',
    })
  })
})
