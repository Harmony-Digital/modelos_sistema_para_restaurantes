import { describe, expect, it } from 'vitest'
import { alternarStatus, dataDoEvento, haQuanto, hrefEventos, linksTelefone, statusDaUrl, statusPossiveis } from './eventos'

describe('eventos: filtros e transições', () => {
  it('statusPossiveis: atual mais as transições válidas', () => {
    expect(statusPossiveis('novo')).toEqual(['novo', 'em_contato', 'confirmado', 'recusado', 'cancelado'])
    expect(statusPossiveis('em_contato')).toEqual(['em_contato', 'confirmado', 'recusado', 'cancelado'])
    expect(statusPossiveis('confirmado')).toEqual(['confirmado', 'cancelado'])
    expect(statusPossiveis('recusado')).toEqual(['recusado'])
    expect(statusPossiveis('cancelado')).toEqual(['cancelado'])
  })
  it('statusDaUrl: padrão, lista e lixo', () => {
    expect(statusDaUrl(undefined)).toEqual(['novo', 'em_contato'])
    expect(statusDaUrl('confirmado,novo')).toEqual(['novo', 'confirmado'])
    expect(statusDaUrl('x,y')).toEqual(['novo', 'em_contato'])
    expect(statusDaUrl('')).toEqual(['novo', 'em_contato'])
  })
  it('hrefEventos omite o padrão e o filtro de unidade vazio', () => {
    expect(hrefEventos({ status: ['novo', 'em_contato'], unidade: null })).toBe('/agenda?aba=eventos')
    expect(hrefEventos({ status: ['novo', 'confirmado'], unidade: 'u1' })).toBe('/agenda?aba=eventos&status=novo,confirmado&unidade=u1')
  })
  it('alternarStatus liga, desliga e nunca esvazia', () => {
    expect(alternarStatus(['novo', 'em_contato'], 'confirmado')).toEqual(['novo', 'em_contato', 'confirmado'])
    expect(alternarStatus(['novo', 'em_contato'], 'novo')).toEqual(['em_contato'])
    expect(alternarStatus(['novo'], 'novo')).toEqual(['novo'])
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
