import { describe, expect, it } from 'vitest'
import { rotuloProvedorIa } from './provedor-ia'

describe('rotuloProvedorIa', () => {
  it('segue AI_PROVIDER quando definido', () => {
    expect(rotuloProvedorIa({ AI_PROVIDER: 'openai', NODE_ENV: 'development' })).toBe('OpenAI')
    expect(rotuloProvedorIa({ AI_PROVIDER: 'openrouter', NODE_ENV: 'production' })).toBe('OpenRouter')
  })
  it('sem AI_PROVIDER: OpenRouter no desenvolvimento, OpenAI em produção', () => {
    expect(rotuloProvedorIa({})).toBe('OpenRouter')
    expect(rotuloProvedorIa({ AI_PROVIDER: '', NODE_ENV: 'development' })).toBe('OpenRouter')
    expect(rotuloProvedorIa({ NODE_ENV: 'production' })).toBe('OpenAI')
  })
  it('valor desconhecido não vira rótulo inventado', () => {
    expect(rotuloProvedorIa({ AI_PROVIDER: 'anthropic' })).toBe('OpenRouter')
  })
})
