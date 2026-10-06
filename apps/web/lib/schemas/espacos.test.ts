import { describe, expect, it } from 'vitest'
import { espacoSchema } from './espacos'

const ok = { nome: 'Salão', capacidadeMin: 20, capacidadeMax: 80, descricao: '', condicoes: '', ativo: true }
describe('espacoSchema', () => {
  it('aceita um espaço válido', () => expect(espacoSchema.safeParse(ok).success).toBe(true))
  it('recusa nome vazio ou longo', () => {
    expect(espacoSchema.safeParse({ ...ok, nome: ' ' }).success).toBe(false)
    expect(espacoSchema.safeParse({ ...ok, nome: 'a'.repeat(61) }).success).toBe(false)
  })
  it('recusa capacidade fora de 1–1000 ou não inteira', () => {
    for (const v of [0, 1001, 2.5]) expect(espacoSchema.safeParse({ ...ok, capacidadeMin: v, capacidadeMax: 1000 }).success).toBe(false)
  })
  it('mínimo maior que máximo', () => {
    const r = espacoSchema.safeParse({ ...ok, capacidadeMin: 90 })
    expect(r.success ? '' : r.error.issues[0]!.message).toBe('A capacidade mínima não pode ser maior que a máxima.')
  })
  it('limites de descrição e condições', () => {
    expect(espacoSchema.safeParse({ ...ok, descricao: 'a'.repeat(301) }).success).toBe(false)
    expect(espacoSchema.safeParse({ ...ok, condicoes: 'a'.repeat(501) }).success).toBe(false)
  })
})
