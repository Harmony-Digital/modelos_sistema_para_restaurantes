import { describe, expect, it } from 'vitest'
import type { ItemExtraido } from '@atd/core'
import { chaveItemS3, extracaoCorretaS3 } from './comparar.ts'
import { can, completo, esp, h, ped } from './casos.ts'
import { CONTEXTO, ESPACOS } from './fixture.ts'

const agora = new Date('2026-10-05T14:00:00-03:00')
const k = (i: ItemExtraido) => chaveItemS3(i, CONTEXTO, agora, ESPACOS)

describe('comparação de extração S3', () => {
  it('equivalências que levam ao mesmo pedido', () => {
    expect(k(completo())).toBe(k(completo({ unidade: 'Asa Sul', data: '10/10', tipoEvento: 'niver' })))
    expect(k(completo({ espaco: 'salão principal' }))).toBe(k(completo({ espaco: 'no Salao Principal' })))
    expect(k(completo({ espaco: '*' }))).toBe(k(completo({ espaco: '*' })))
    expect(k(can({ unidade: 'aza norte' }))).toBe(k(can({ unidade: 'asa norte' })))
  })
  it('diferenças que mudam o pedido', () => {
    const a = completo()
    for (const outro of [{ convidados: 41 }, { unidade: 'asa norte' }, { data: 'domingo' }, { tipoEvento: 'casamento' }, { tipoEvento: null }, { espaco: '*' }, { espaco: 'varanda' }, { convidados: null }]) {
      expect(k({ ...a, ...outro })).not.toBe(k(a))
    }
    expect(k(ped({ unidade: 'asa sul' }))).not.toBe(k(can({ unidade: 'asa sul' })))
    expect(k(esp({ unidade: 'asa sul' }))).not.toBe(k(ped({ unidade: 'asa sul' })))
  })
  it('itens de outros serviços usam as chaves do S1/S2; ordem não importa; itens a mais ou a menos importam', () => {
    const a = [completo(), h('info', null, null, 'estacionamento')]
    expect(extracaoCorretaS3(a, [...a].reverse(), CONTEXTO, agora, ESPACOS)).toBe(true)
    expect(extracaoCorretaS3(a, a.slice(0, 1), CONTEXTO, agora, ESPACOS)).toBe(false)
    expect(extracaoCorretaS3([], [completo()], CONTEXTO, agora, ESPACOS)).toBe(false)
  })
})
