import { describe, expect, it } from 'vitest'
import { custoOpenAi, modelosSemPreco, PRECOS_CONSULTADOS_EM, PRECOS_OPENAI } from './precos-openai.ts'

describe('tabela de preços da OpenAI', () => {
  it('tem os modelos de partida e a data da consulta', () => {
    for (const m of ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4.1-nano', 'gpt-5-mini', 'gpt-5-nano']) {
      expect(PRECOS_OPENAI[m], m).toBeDefined()
    }
    expect(PRECOS_CONSULTADOS_EM).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(PRECOS_OPENAI['gpt-4.1-mini']).toEqual({ entrada: 0.4, cache: 0.1, saida: 1.6 })
  })

  it('custo: entrada sem cache + cache + saída, por 1M tokens', () => {
    // gpt-4.1-mini: 1000 entrada (200 em cache) e 500 saída
    // 800 × 0,40 + 200 × 0,10 + 500 × 1,60 = 320 + 20 + 800 = 1140 micro-USD
    expect(custoOpenAi('gpt-4.1-mini', { tokensIn: 1000, tokensCache: 200, tokensOut: 500 })).toBe('0.001140')
  })

  it('arredonda para cima em micro-USD (chamada paga nunca vira 0)', () => {
    // gpt-5-nano: 1 token de entrada = 0,05 micro-USD → 0.000001
    expect(custoOpenAi('gpt-5-nano', { tokensIn: 1, tokensCache: 0, tokensOut: 0 })).toBe('0.000001')
    expect(custoOpenAi('gpt-4.1', { tokensIn: 0, tokensCache: 0, tokensOut: 0 })).toBe('0.000000')
  })

  it('aceita o snapshot datado devolvido pela API', () => {
    expect(custoOpenAi('gpt-4.1-mini-2025-04-14', { tokensIn: 1000, tokensCache: 0, tokensOut: 0 })).toBe('0.000400')
  })

  it('cache maior que a entrada não gera custo negativo', () => {
    expect(custoOpenAi('gpt-4.1-mini', { tokensIn: 100, tokensCache: 500, tokensOut: 0 })).toBe('0.000010')
  })

  it('modelo desconhecido ⇒ null', () => {
    expect(custoOpenAi('gpt-9-ultra', { tokensIn: 10, tokensCache: 0, tokensOut: 10 })).toBeNull()
  })

  it('modelosSemPreco lista os que faltam na tabela', () => {
    expect(modelosSemPreco(['gpt-4.1-mini', 'gpt-9-ultra', 'gpt-4.1', 'x'])).toEqual(['gpt-9-ultra', 'x'])
    expect(modelosSemPreco([])).toEqual([])
  })
})
