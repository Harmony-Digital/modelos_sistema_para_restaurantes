import { describe, expect, it } from 'vitest'
import { DADOS_RETENCAO, MAXIMO_RETENCAO, minimoRetencao } from '@atd/db'
import { confirmouExclusao, DADOS_RETENCAO_TELA, MAXIMO_DIAS_RETENCAO, minimoDiasRetencao, negarSchema, retencaoSchema } from './privacidade'

describe('schemas de privacidade', () => {
  it('as regras da tela são as mesmas do banco', () => {
    expect([...DADOS_RETENCAO_TELA]).toEqual([...DADOS_RETENCAO])
    expect(MAXIMO_DIAS_RETENCAO).toBe(MAXIMO_RETENCAO)
    for (const d of DADOS_RETENCAO_TELA) expect(minimoDiasRetencao(d)).toBe(minimoRetencao(d))
  })

  it('confirmação da exclusão exige a palavra', () => {
    expect(confirmouExclusao('EXCLUIR')).toBe(true)
    expect(confirmouExclusao(' excluir ')).toBe(true)
    expect(confirmouExclusao('excluir já')).toBe(false)
    expect(confirmouExclusao('')).toBe(false)
  })

  it('retenção: inteiro entre o mínimo e 10 anos', () => {
    expect(retencaoSchema.safeParse({ dado: 'messages', dias: 7 }).success).toBe(true)
    expect(retencaoSchema.safeParse({ dado: 'messages', dias: 6 }).success).toBe(false)
    expect(retencaoSchema.safeParse({ dado: 'audit_log', dias: 29 }).success).toBe(false)
    expect(retencaoSchema.safeParse({ dado: 'audit_log', dias: 3651 }).success).toBe(false)
    expect(retencaoSchema.safeParse({ dado: 'audit_log', dias: Number.NaN }).success).toBe(false)
  })

  it('negar: 1 a 300 caracteres', () => {
    expect(negarSchema.safeParse({ resposta: ' ' }).success).toBe(false)
    expect(negarSchema.safeParse({ resposta: 'ok' }).success).toBe(true)
  })
})
