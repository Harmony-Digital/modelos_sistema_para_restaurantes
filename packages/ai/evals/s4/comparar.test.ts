import { describe, expect, it } from 'vitest'
import type { ItemExtraido } from '@atd/core'
import { buscar, card, completo, enviar, filtro, horario, mudanca, ped, preco } from './casos.ts'
import { chaveItemS4, extracaoCorretaS4, normalizarConsulta } from './comparar.ts'
import { CONTEXTO, ESPACOS } from './fixture.ts'

const agora = new Date('2026-10-05T14:00:00-03:00')
const k = (i: ItemExtraido) => chaveItemS4(i, CONTEXTO, agora, ESPACOS)

describe('comparação de extração S4', () => {
  it('equivalências que levam à mesma resposta', () => {
    expect(normalizarConsulta('o Petit Gâteau')).toBe(normalizarConsulta('petit gateau'))
    expect(k(preco('picanha'))).toBe(k(buscar('a Picanha')))
    expect(k(preco('chopp', 'Asa Norte'))).toBe(k(preco('chopp', 'asa norte')))
    expect(k(card(null))).toBe(k(enviar()))
    expect(k(card('preco'))).toBe(k(enviar()))
    expect(k(card(null, { tag: 'vegano' }))).toBe(k(filtro('vegano')))
    expect(k(mudanca({ convidados: 60 }))).toBe(k({ ...mudanca({ convidados: 60 }), tipoEvento: 'festa', tema: 'na verdade mudar convidados' }))
  })
  it('diferenças que mudam a resposta', () => {
    expect(k(preco('picanha'))).not.toBe(k(preco('fraldinha')))
    expect(k(preco('picanha'))).not.toBe(k(preco('picanha', 'asa sul')))
    expect(k(filtro('vegano'))).not.toBe(k(filtro('vegetariano')))
    expect(k(filtro('vegano'))).not.toBe(k(enviar()))
    expect(k(mudanca({ convidados: 60 }))).not.toBe(k(ped({ convidados: 60 })))
    expect(k(mudanca({ convidados: 60 }))).not.toBe(k(mudanca({ convidados: 50 })))
  })
  it('itens de outros serviços usam as chaves anteriores; ordem não importa; itens a mais importam', () => {
    const a = [preco('picanha'), horario('endereco', 'asa sul'), completo()]
    expect(extracaoCorretaS4(a, [...a].reverse(), CONTEXTO, agora, ESPACOS)).toBe(true)
    expect(extracaoCorretaS4(a, a.slice(1), CONTEXTO, agora, ESPACOS)).toBe(false)
    expect(extracaoCorretaS4([], [enviar()], CONTEXTO, agora, ESPACOS)).toBe(false)
  })
})
