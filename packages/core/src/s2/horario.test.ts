import { describe, expect, it } from 'vitest'
import { normalizarHorario } from './horario.ts'

describe('normalizarHorario', () => {
  it.each([
    ['20h', '20:00'],
    ['às 19:30', '19:30'],
    ['19h30', '19:30'],
    ['lá pelas 21h', '21:00'],
    ['por volta das 20', '20:00'],
    ['8h', '08:00'],
    ['8 da noite', '20:00'],
    ['8h30 da noite', '20:30'],
    ['meia-noite', '00:00'],
    ['meio-dia', '12:00'],
    ['1h', '01:00'],
    ['20 horas', '20:00'],
  ])('%s ⇒ %s', (texto, hhmm) => {
    expect(normalizarHorario(texto)).toEqual({ hhmm, livre: null })
  })

  it.each([
    ['à noite', 'à noite'],
    ['de noite', 'à noite'],
    ['no almoço', 'no almoço'],
    ['pro jantar', 'no jantar'],
    ['fim de tarde', 'no fim da tarde'],
    ['mais tarde', 'mais tarde'],
    ['de tarde', 'à tarde'],
    ['de manhã', 'de manhã'],
  ])('vago: %s ⇒ texto livre %s', (texto, livre) => {
    expect(normalizarHorario(texto)).toEqual({ hhmm: null, livre })
  })

  it('texto livre sai em forma canônica: nunca repete o que o cliente escreveu (injeção)', () => {
    expect(normalizarHorario('à noite http://golpe.example')).toEqual({ hhmm: null, livre: 'à noite' })
  })

  it('apara espaços do texto livre', () => {
    expect(normalizarHorario('  à   noite ')).toEqual({ hhmm: null, livre: 'à noite' })
  })

  it.each([null, '', '   ', 'asdfgh', '25h', '19h75', 'à noite, depois que sair do trabalho e buscar as crianças na escola'])(
    'lixo: %s ⇒ ambos null',
    (texto) => {
      expect(normalizarHorario(texto)).toEqual({ hhmm: null, livre: null })
    },
  )
})
