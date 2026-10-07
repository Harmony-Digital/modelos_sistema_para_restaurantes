import { describe, expect, it } from 'vitest'
import { MODELOS_S1, type ChaveModelo } from '@atd/core/s1'
import { previaModelo, ROTULOS_MODELO } from './modelos-tela'

const unidade = { nome: 'Lago Sul', endereco: 'SHIS QI 11 Bloco A', bairro: 'Lago Sul', cidade: 'Brasília', uf: 'DF', mapsUrl: null }

describe('modelos na tela', () => {
  it('todo modelo tem título e explicação', () => {
    expect(Object.keys(ROTULOS_MODELO).sort()).toEqual(Object.keys(MODELOS_S1).sort())
  })
  it('modelos de evento têm título próprio, único e em português', () => {
    const titulos = Object.values(ROTULOS_MODELO).map((r) => r.titulo)
    for (const [chave, r] of Object.entries(ROTULOS_MODELO).filter(([c]) => c.startsWith('evento_'))) {
      expect(r.titulo.length, chave).toBeGreaterThan(10)
      expect(titulos.filter((t) => t === r.titulo), chave).toHaveLength(1)
    }
  })
  it('modelos da reserva têm título próprio e a prévia monta o resumo com as regras', () => {
    const titulos = Object.values(ROTULOS_MODELO).map((r) => r.titulo)
    for (const [chave, r] of Object.entries(ROTULOS_MODELO).filter(([c]) => c.startsWith('reserva_'))) {
      expect(titulos.filter((t) => t === r.titulo), chave).toHaveLength(1)
    }
    expect(previaModelo('reserva_confirmada', MODELOS_S1.reserva_confirmada.texto, unidade))
      .toMatch(/^Reserva feita: unidade Lago Sul, domingo \(11\/10\), às 20h, 4 pessoas, em nome de Ana Souza\.\n\nSua reserva está confirmada!/)
    expect(previaModelo('reserva_lotada', MODELOS_S1.reserva_lotada.texto, unidade))
      .toBe('A unidade Lago Sul está lotada no domingo (11/10) para 4 pessoas.')
    expect(previaModelo('reserva_qual_cancelar', MODELOS_S1.reserva_qual_cancelar.texto, unidade))
      .toContain('"cancela a reserva de hoje na unidade Lago Sul"')
  })
  it('prévia usa os dados reais da unidade', () => {
    expect(previaModelo('endereco', MODELOS_S1.endereco.texto, unidade)).toBe('A unidade Lago Sul fica em SHIS QI 11 Bloco A, Lago Sul, Brasília/DF.')
    expect(previaModelo('aberto_sim', 'Aberta! {unidade} fecha {fecha}.', unidade)).toBe('Aberta! Lago Sul fecha às 23h.')
    expect(previaModelo('lacuna', MODELOS_S1.lacuna.texto, null)).toBe('Ainda não tenho essa informação; vou verificar com a equipe.')
  })
  it('a prévia preenche todas as variáveis de todos os modelos', () => {
    for (const chave of Object.keys(MODELOS_S1) as ChaveModelo[]) {
      expect(previaModelo(chave, MODELOS_S1[chave].texto, unidade), chave).not.toMatch(/\{\w+\}/)
    }
    expect(previaModelo('aviso_qual_cancelar', MODELOS_S1.aviso_qual_cancelar.texto, unidade))
      .toContain('Para cancelar, mande por exemplo: "cancela o aviso de hoje na unidade Lago Sul".')
  })
})
