import { describe, expect, it } from 'vitest'
import type { ItemExtraido } from '@atd/core'
import { chaveItemS2, extracaoCorretaS2, horasInventadasS2 } from './comparar.ts'
import { CONTEXTO } from './fixture.ts'

const agora = new Date('2026-10-05T14:00:00-03:00')
const base = { unidade: null, data: null, tema: null, pessoas: null, horario: null, convidados: null, tipoEvento: null, espaco: null, consulta: null, tag: null }
const reg = (extra: Partial<ItemExtraido> = {}): ItemExtraido => ({ servico: 'aviso_presenca', tipo: 'registrar', ...base, ...extra })
const can = (extra: Partial<ItemExtraido> = {}): ItemExtraido => reg({ tipo: 'cancelar', ...extra })
const k = (i: ItemExtraido) => chaveItemS2(i, CONTEXTO, agora)

describe('comparação de extração S2', () => {
  it('equivalências que levam ao mesmo aviso', () => {
    expect(k(reg({ unidade: 'asa sul', data: 'amanhã', pessoas: 4, horario: '20h' }))).toBe(k(reg({ unidade: 'Asa Sul', data: 'amanha', pessoas: 4, horario: 'às 20:00' })))
    expect(k(reg({ unidade: 'asa sul', data: 'hoje', pessoas: 2 }))).toBe(k(reg({ unidade: 'asa sul', pessoas: 2 })))
    expect(k(reg({ unidade: 'asa sul', pessoas: 2, horario: 'umas 8 da noite' }))).toBe(k(reg({ unidade: 'asa sul', pessoas: 2, horario: '20h' })))
    expect(k(can({ unidade: 'aza norte' }))).toBe(k(can({ unidade: 'asa norte' })))
  })
  it('diferenças que mudam o aviso', () => {
    const a = reg({ unidade: 'asa sul', data: 'sábado', pessoas: 4, horario: '20h' })
    for (const outro of [{ pessoas: 5 }, { unidade: 'asa norte' }, { data: 'domingo' }, { horario: '21h' }, { horario: null }, { tipo: 'cancelar' as const }]) {
      expect(k({ ...a, ...outro })).not.toBe(k(a))
    }
    expect(k(reg({ pessoas: null }))).not.toBe(k(reg({ pessoas: 2 })))
  })
  it('item S1 usa a chave do S1; ordem não importa; itens a mais ou a menos importam', () => {
    const h: ItemExtraido = { servico: 'horario_unidades', tipo: 'info', ...base, tema: 'lotacao' }
    const a = [reg({ unidade: 'asa sul', pessoas: 2 }), h]
    expect(extracaoCorretaS2(a, [...a].reverse(), CONTEXTO, agora)).toBe(true)
    expect(extracaoCorretaS2(a, a.slice(0, 1), CONTEXTO, agora)).toBe(false)
    expect(extracaoCorretaS2([h], [reg({ pessoas: 2 })], CONTEXTO, agora)).toBe(false)
  })
})

describe('horasInventadasS2', () => {
  const itens = [reg({ unidade: 'asa norte', pessoas: 2, horario: 'por volta das 21h30' })]
  it('aceita a hora que o cliente informou, mesmo fora do cadastro', () => {
    expect(horasInventadasS2('Anotado: Asa Norte, hoje, 2 pessoas, por volta das 21h30.', CONTEXTO, itens)).toEqual([])
  })
  it('continua acusando hora que não veio do cliente nem do banco', () => {
    expect(horasInventadasS2('por volta das 21h30 e das 22h30', CONTEXTO, itens)).toEqual(['22:30'])
    expect(horasInventadasS2('por volta das 21h30', CONTEXTO, [])).toEqual(['21:30'])
    expect(horasInventadasS2('abre 24h', CONTEXTO, itens)).toEqual(['24:00'])
  })
  it('horário só vale se o item for aviso (não vem de outro serviço)', () => {
    const outro: ItemExtraido = { servico: 'cardapio', tipo: null, ...base, horario: '20h' }
    expect(horasInventadasS2('por volta das 21h30', CONTEXTO, [outro])).toEqual(['21:30'])
  })
})
