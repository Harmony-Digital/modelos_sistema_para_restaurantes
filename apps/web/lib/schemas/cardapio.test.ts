import { describe, expect, it } from 'vitest'
import { arquivoMetaSchema, categoriaSchema, excecaoSchema, itemSchema, TAGS_CARDAPIO } from './cardapio'

const CAT = '00000000-0000-4000-8000-000000000001'
const base = { categoryId: CAT, nome: 'Picanha', descricao: '', preco: 'R$ 89,90', tags: [], outrosNomes: [], disponivel: true, ordem: 0 }

describe('categoriaSchema', () => {
  it('exige nome e posição numérica', () => {
    expect(categoriaSchema.safeParse({ nome: ' ', ordem: '1', ativo: true }).success).toBe(false)
    expect(categoriaSchema.safeParse({ nome: 'Carnes', ordem: 'x', ativo: true }).success).toBe(false)
    expect(categoriaSchema.parse({ nome: ' Carnes ', ordem: '3', ativo: true })).toEqual({ nome: 'Carnes', ordem: 3, ativo: true })
  })
})

describe('itemSchema', () => {
  it('preço mascarado vira centavos; vazio vira sob consulta', () => {
    expect(itemSchema.parse(base)).toMatchObject({ preco: 8990, descricao: null })
    expect(itemSchema.parse({ ...base, preco: '' })).toMatchObject({ preco: null })
  })
  it('rejeita categoria inválida, nome vazio/longo, tag fora do formato e excesso de listas', () => {
    expect(itemSchema.safeParse({ ...base, categoryId: 'x' }).success).toBe(false)
    expect(itemSchema.safeParse({ ...base, nome: '' }).success).toBe(false)
    expect(itemSchema.safeParse({ ...base, nome: 'a'.repeat(81) }).success).toBe(false)
    expect(itemSchema.safeParse({ ...base, descricao: 'a'.repeat(301) }).success).toBe(false)
    // etiqueta própria vinda do CSV ("Do chef" ⇒ do_chef) é preservada ao salvar o item (M3)
    expect(itemSchema.safeParse({ ...base, tags: ['picante', 'do_chef'] }).success).toBe(true)
    for (const ruim of ['Picante', 'do chef', '', 'a'.repeat(31), '<b>']) expect(itemSchema.safeParse({ ...base, tags: [ruim] }).success, ruim).toBe(false)
    expect(itemSchema.safeParse({ ...base, tags: [TAGS_CARDAPIO[0]] }).success).toBe(true)
    expect(itemSchema.safeParse({ ...base, outrosNomes: Array.from({ length: 11 }, (_, i) => `n${i}`) }).success).toBe(false)
  })
  it('preço acima do limite é recusado', () => {
    expect(itemSchema.safeParse({ ...base, preco: 'R$ 100.000,01' }).success).toBe(false)
    expect(itemSchema.safeParse({ ...base, preco: 'R$ 100.000,00' }).success).toBe(true)
  })
})

describe('excecaoSchema', () => {
  const ids = { itemId: CAT, unitId: CAT }
  it('segue o item e preço vazio = nulos', () => {
    expect(excecaoSchema.parse({ ...ids, disponivel: 'segue', preco: '' })).toEqual({ ...ids, disponivel: null, precoOverrideCentavos: null })
    expect(excecaoSchema.parse({ ...ids, disponivel: 'nao', preco: 'R$ 9,00' })).toEqual({ ...ids, disponivel: false, precoOverrideCentavos: 900 })
    expect(excecaoSchema.safeParse({ ...ids, disponivel: 'talvez', preco: '' }).success).toBe(false)
  })
})

describe('arquivoMetaSchema', () => {
  it('título obrigatório e unidade vazia = geral', () => {
    expect(arquivoMetaSchema.safeParse({ titulo: '', unitId: '' }).success).toBe(false)
    expect(arquivoMetaSchema.parse({ titulo: ' Cardápio ', unitId: '' })).toEqual({ titulo: 'Cardápio', unitId: null })
    expect(arquivoMetaSchema.safeParse({ titulo: 'x', unitId: 'abc' }).success).toBe(false)
  })
})
