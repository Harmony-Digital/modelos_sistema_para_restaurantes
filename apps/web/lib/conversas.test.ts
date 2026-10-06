import { describe, expect, it } from 'vitest'
import { abaDe, formatarEspera, haQuanto, topicosInbox, tituloComContador } from './conversas'

describe('topicosInbox', () => {
  it('acesso a todas ⇒ só o tópico do restaurante', () => {
    expect(topicosInbox({ restaurantId: 'r1', todas: true, unidades: [{ id: 'a' }, { id: 'b' }] })).toEqual(['inbox:r:r1'])
  })
  it('restrito ⇒ um tópico por unidade permitida (nenhuma ⇒ nenhum)', () => {
    expect(topicosInbox({ restaurantId: 'r1', todas: false, unidades: [{ id: 'a' }, { id: 'b' }] })).toEqual(['inbox:u:a', 'inbox:u:b'])
    expect(topicosInbox({ restaurantId: 'r1', todas: false, unidades: [] })).toEqual([])
  })
})

describe('tituloComContador', () => {
  it('põe, troca e tira o contador', () => {
    expect(tituloComContador('Atendimento IA', 2)).toBe('(2) Atendimento IA')
    expect(tituloComContador('(2) Atendimento IA', 5)).toBe('(5) Atendimento IA')
    expect(tituloComContador('(5) Atendimento IA', 0)).toBe('Atendimento IA')
  })
})

describe('formatarEspera', () => {
  it.each([
    [null, '—'], [42, '42 s'], [180, '3 min'], [3600, '1 h'], [3900, '1 h 5 min'],
  ])('%s ⇒ %s', (s, txt) => expect(formatarEspera(s)).toBe(txt))
})

describe('abaDe e haQuanto', () => {
  it('aba desconhecida cai em Aguardando', () => {
    expect(abaDe('em_atendimento')).toBe('em_atendimento')
    expect(abaDe('comigo')).toBe('aguardando')
    expect(abaDe(undefined)).toBe('aguardando')
  })
  it('tempo relativo em pt-BR', () => {
    const agora = new Date('2026-10-06T12:00:00Z')
    expect(haQuanto(new Date('2026-10-06T11:55:00Z'), agora)).toBe('há 5 minutos')
    expect(haQuanto(new Date('2026-10-06T09:00:00Z'), agora)).toBe('há 3 horas')
  })
})
