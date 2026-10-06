import { describe, expect, it } from 'vitest'
import { LIMITES_RASCUNHO, rascunhoSchema, type RascunhoCardapio } from './rascunho.ts'

const item = (o: Partial<RascunhoCardapio['categorias'][number]['itens'][number]> = {}) => ({
  nome: 'Picanha', descricao: null, precoCentavos: 5990, tags: [], outrosNomes: [], unidade: null, incluir: true, ...o,
})
const rascunho = (itens = [item()], nome = 'Carnes'): RascunhoCardapio => ({ categorias: [{ nome, itens }] })

describe('rascunhoSchema', () => {
  it('aceita um rascunho válido e apara espaços dos nomes', () => {
    const r = rascunhoSchema.parse({ categorias: [{ nome: ' Carnes ', itens: [item({ nome: ' Picanha ', tags: ['bebida'], outrosNomes: ['pica'] })] }] })
    expect(r.categorias[0]!.nome).toBe('Carnes')
    expect(r.categorias[0]!.itens[0]!.nome).toBe('Picanha')
  })

  it('preço: inteiro de 0 a 10 000 000 centavos ou null', () => {
    expect(rascunhoSchema.safeParse(rascunho([item({ precoCentavos: null })])).success).toBe(true)
    expect(rascunhoSchema.safeParse(rascunho([item({ precoCentavos: 0 })])).success).toBe(true)
    expect(rascunhoSchema.safeParse(rascunho([item({ precoCentavos: 10_000_000 })])).success).toBe(true)
    expect(rascunhoSchema.safeParse(rascunho([item({ precoCentavos: 10_000_001 })])).success).toBe(false)
    expect(rascunhoSchema.safeParse(rascunho([item({ precoCentavos: -1 })])).success).toBe(false)
    expect(rascunhoSchema.safeParse(rascunho([item({ precoCentavos: 59.9 })])).success).toBe(false)
  })

  it('nome 1..80, descrição ≤ 300', () => {
    expect(rascunhoSchema.safeParse(rascunho([item({ nome: '   ' })])).success).toBe(false)
    expect(rascunhoSchema.safeParse(rascunho([item({ nome: 'x'.repeat(80) })])).success).toBe(true)
    expect(rascunhoSchema.safeParse(rascunho([item({ nome: 'x'.repeat(81) })])).success).toBe(false)
    expect(rascunhoSchema.safeParse(rascunho([item()], 'x'.repeat(81))).success).toBe(false)
    expect(rascunhoSchema.safeParse(rascunho([item({ descricao: 'x'.repeat(300) })])).success).toBe(true)
    expect(rascunhoSchema.safeParse(rascunho([item({ descricao: 'x'.repeat(301) })])).success).toBe(false)
  })

  it('≤ 50 categorias e ≤ 500 itens no total', () => {
    const cats = (n: number, porCat: number) => ({
      categorias: Array.from({ length: n }, (_, i) => ({
        nome: `C${i}`, itens: Array.from({ length: porCat }, (_, j) => item({ nome: `I${i}-${j}` })),
      })),
    })
    expect(rascunhoSchema.safeParse(cats(50, 10)).success).toBe(true)
    expect(rascunhoSchema.safeParse(cats(51, 1)).success).toBe(false)
    expect(rascunhoSchema.safeParse(cats(10, 51)).success).toBe(false)
    expect(LIMITES_RASCUNHO).toMatchObject({ categorias: 50, itens: 500, nome: 80, descricao: 300, precoMax: 10_000_000 })
  })

  it('rejeita campos ausentes ou de tipo errado', () => {
    expect(rascunhoSchema.safeParse({}).success).toBe(false)
    expect(rascunhoSchema.safeParse({ categorias: [{ nome: 'C', itens: [{ nome: 'X' }] }] }).success).toBe(false)
    expect(rascunhoSchema.safeParse(rascunho([item({ tags: 'vegano' as unknown as string[] })])).success).toBe(false)
  })
})
