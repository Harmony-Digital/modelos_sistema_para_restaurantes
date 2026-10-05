import { describe, expect, it } from 'vitest'
import { MODELOS_S1 } from '@atd/core/s1'
import { previaModelo, ROTULOS_MODELO } from './modelos-tela'

const unidade = { nome: 'Lago Sul', endereco: 'SHIS QI 11 Bloco A', bairro: 'Lago Sul', cidade: 'Brasília', uf: 'DF', mapsUrl: null }

describe('modelos na tela', () => {
  it('todo modelo tem título e explicação', () => {
    expect(Object.keys(ROTULOS_MODELO).sort()).toEqual(Object.keys(MODELOS_S1).sort())
  })
  it('prévia usa os dados reais da unidade', () => {
    expect(previaModelo('endereco', MODELOS_S1.endereco.texto, unidade)).toBe('A unidade Lago Sul fica em SHIS QI 11 Bloco A, Lago Sul, Brasília/DF.')
    expect(previaModelo('aberto_sim', 'Aberta! {unidade} fecha {fecha}.', unidade)).toBe('Aberta! Lago Sul fecha às 23h.')
    expect(previaModelo('lacuna', MODELOS_S1.lacuna.texto, null)).toBe('Ainda não tenho essa informação; vou verificar com a equipe.')
  })
})
