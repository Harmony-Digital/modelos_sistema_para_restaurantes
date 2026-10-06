import { describe, expect, it } from 'vitest'
import { lerTriagem, TRIAGEM_PADRAO } from './triagem.ts'

describe('lerTriagem (opção --triagem dos evals de extração)', () => {
  it('padrão é a v4, a que roda em produção', () => {
    expect(TRIAGEM_PADRAO).toBe('v4')
    expect(lerTriagem(undefined, 'v2')).toBe('v4')
    expect(lerTriagem(undefined, 'v3')).toBe('v4')
  })
  it('a versão anterior continua como opção', () => {
    expect(lerTriagem('v2', 'v2')).toBe('v2')
    expect(lerTriagem('v3', 'v3')).toBe('v3')
    expect(lerTriagem('v4', 'v3')).toBe('v4')
  })
  it('outra versão é recusada', () => {
    expect(() => lerTriagem('v3', 'v2')).toThrow('--triagem deve ser v2 ou v4')
    expect(() => lerTriagem('v1', 'v3')).toThrow('--triagem deve ser v3 ou v4')
  })
})
