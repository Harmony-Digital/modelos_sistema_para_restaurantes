import { describe, expect, it } from 'vitest'
import type { ItemExtraido } from '@atd/core'
import { chaveItem, extracaoCorreta, horasInventadas } from './comparar.ts'
import { CONTEXTO } from './fixture.ts'

const agora = new Date('2026-10-05T14:00:00-03:00')
const h = (tipo: ItemExtraido['tipo'], unidade: string | null = null, data: string | null = null, tema: string | null = null): ItemExtraido =>
  ({ servico: 'horario_unidades', tipo, unidade, data, tema, pessoas: null, horario: null })

describe('comparação de extração', () => {
  it('equivalências que levam à mesma resposta', () => {
    const k = (i: ItemExtraido) => chaveItem(i, CONTEXTO, agora)
    expect(k(h('horario_dia', 'asa sul', 'amanhã'))).toBe(k(h('horario_dia', 'Asa Sul', 'amanha')))
    expect(k(h('endereco', 'asa norte'))).toBe(k(h('endereco', 'aza norte')))
    expect(k(h('feriado', 'asa sul'))).toBe(k(h('horario_dia', 'asa sul', '12/10')))
    expect(k(h('aberto_agora', 'asa sul', 'hoje'))).toBe(k(h('aberto_agora', 'asa sul')))
    expect(k(h('info', 'asa sul', null, 'pet'))).toBe(k(h('info', null, null, 'cachorro')))
    expect(k(h('lista_unidades', 'asa sul'))).toBe(k(h('lista_unidades')))
  })
  it('diferenças que mudam a resposta', () => {
    const k = (i: ItemExtraido) => chaveItem(i, CONTEXTO, agora)
    expect(k(h('horario_dia', 'asa sul', 'amanhã'))).not.toBe(k(h('horario_dia', 'asa norte', 'amanhã')))
    expect(k(h('info', null, null, 'wifi'))).not.toBe(k(h('info', 'asa norte', null, 'wifi')))
    expect(k(h('aberto_agora', 'asa sul'))).not.toBe(k(h('horario_dia', 'asa sul', 'amanhã')))
    expect(k(h('como_chegar', 'asa norte'))).not.toBe(k(h('endereco', 'asa norte')))
  })
  it('ordem dos itens não importa; itens a mais ou a menos importam', () => {
    const a = [h('endereco', 'asa sul'), h('info', null, null, 'estacionamento')]
    expect(extracaoCorreta(a, [...a].reverse(), CONTEXTO, agora)).toBe(true)
    expect(extracaoCorreta(a, a.slice(0, 1), CONTEXTO, agora)).toBe(false)
  })
})

describe('horasInventadas', () => {
  it('aceita horas do cadastro e dos fatos; acusa as que não existem', () => {
    expect(horasInventadas('das 11h30 às 16h e das 18h às 2h; música a partir das 20h; até a meia-noite', CONTEXTO)).toEqual(['00:00'])
    expect(horasInventadas('abre 24h', CONTEXTO)).toEqual(['24:00'])
    expect(horasInventadas('Hoje, a unidade Asa Norte abre das 11h às 23h.', CONTEXTO)).toEqual([])
  })
})
