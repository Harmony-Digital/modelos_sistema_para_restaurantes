import { describe, expect, it } from 'vitest'
import { lerTriagem, TRIAGEM_PADRAO } from './triagem.ts'

describe('lerTriagem (opção --triagem dos evals de extração)', () => {
  it('padrão é a v7, a que roda em produção', () => {
    expect(TRIAGEM_PADRAO).toBe('v7')
    expect(lerTriagem(undefined, 'v2')).toBe('v7')
    expect(lerTriagem(undefined, 'v3')).toBe('v7')
    expect(lerTriagem(undefined, 'v4')).toBe('v7')
    expect(lerTriagem(undefined, 'v5')).toBe('v7')
  })
  it('a v6, a v5, a v4 e a versão anterior do serviço continuam como opção', () => {
    expect(lerTriagem('v7', 'v3')).toBe('v7')
    expect(lerTriagem('v2', 'v2')).toBe('v2')
    expect(lerTriagem('v3', 'v3')).toBe('v3')
    expect(lerTriagem('v4', 'v3')).toBe('v4')
    expect(lerTriagem('v5', 'v2')).toBe('v5')
    expect(lerTriagem('v5', 'v5')).toBe('v5')
    expect(lerTriagem('v6', 'v4')).toBe('v6')
  })
  it('outra versão é recusada', () => {
    expect(() => lerTriagem('v3', 'v2')).toThrow('--triagem deve ser v2, v4, v5, v6 ou v7')
    expect(() => lerTriagem('v1', 'v4')).toThrow('--triagem deve ser v4, v5, v6 ou v7')
    expect(() => lerTriagem('v3', 'v5')).toThrow('--triagem deve ser v5, v4, v6 ou v7')
  })
})
