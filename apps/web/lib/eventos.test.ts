import { describe, expect, it } from 'vitest'
import { dataDoEvento, haQuanto, linksTelefone, membrosDaUnidade, statusPossiveis } from './eventos'

describe('eventos: transições', () => {
  it('statusPossiveis: atual mais as transições válidas', () => {
    expect(statusPossiveis('novo')).toEqual(['novo', 'em_contato', 'confirmado', 'recusado', 'cancelado'])
    expect(statusPossiveis('em_contato')).toEqual(['em_contato', 'confirmado', 'recusado', 'cancelado'])
    expect(statusPossiveis('confirmado')).toEqual(['confirmado', 'cancelado'])
    expect(statusPossiveis('recusado')).toEqual(['recusado'])
    expect(statusPossiveis('cancelado')).toEqual(['cancelado'])
  })
})

describe('eventos: apresentação', () => {
  it('data com dia da semana', () => expect(dataDoEvento('2026-10-10')).toBe('10/10/2026 · Sábado'))
  it('há quanto tempo', () => {
    const agora = new Date('2026-10-05T15:00:00Z')
    expect(haQuanto(new Date('2026-10-05T14:59:30Z'), agora)).toBe('agora há pouco')
    expect(haQuanto(new Date('2026-10-05T14:55:00Z'), agora)).toBe('há 5 min')
    expect(haQuanto(new Date('2026-10-05T14:00:00Z'), agora)).toBe('há 1 hora')
    expect(haQuanto(new Date('2026-10-05T12:00:00Z'), agora)).toBe('há 3 horas')
    expect(haQuanto(new Date('2026-10-02T15:00:00Z'), agora)).toBe('há 3 dias')
    expect(haQuanto(new Date('2026-10-06T15:00:00Z'), agora)).toBe('agora há pouco')
  })
  it('links do telefone só com dígitos', () => {
    expect(linksTelefone('+55 (61) 99999-0000')).toEqual({ tel: 'tel:+5561999990000', wa: 'https://wa.me/5561999990000' })
  })
})

describe('eventos: responsável', () => {
  it('só quem acessa todas as unidades ou a unidade do pedido', () => {
    const ms = [
      { id: 'a', nome: 'Dono', todas: true, unidades: [] },
      { id: 'b', nome: 'Gerente U1', todas: false, unidades: ['u1'] },
      { id: 'c', nome: 'Gerente U2', todas: false, unidades: ['u2'] },
    ]
    expect(membrosDaUnidade(ms, 'u1').map((m) => m.id)).toEqual(['a', 'b'])
    expect(membrosDaUnidade(ms, 'u3').map((m) => m.id)).toEqual(['a'])
  })
})
