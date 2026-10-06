import { describe, expect, it } from 'vitest'
import { MAX_RESPOSTA, respostaSchema } from './conversas'

describe('respostaSchema', () => {
  it('conta code points como a DAL: 4096 emojis cabem, 4097 não', () => {
    expect(respostaSchema.safeParse({ texto: '😀'.repeat(MAX_RESPOSTA) }).success).toBe(true)
    const r = respostaSchema.safeParse({ texto: '😀'.repeat(MAX_RESPOSTA + 1) })
    expect(r.success).toBe(false)
    expect(r.error?.issues[0]?.message).toBe('A resposta passa de 4096 caracteres.')
  })

  it('vazio e só espaços recusados; 4096 letras cabem', () => {
    expect(respostaSchema.safeParse({ texto: '   ' }).error?.issues[0]?.message).toBe('Escreva a resposta.')
    expect(respostaSchema.safeParse({ texto: 'x'.repeat(MAX_RESPOSTA) }).success).toBe(true)
    expect(respostaSchema.safeParse({ texto: 'x'.repeat(MAX_RESPOSTA + 1) }).success).toBe(false)
  })
})
