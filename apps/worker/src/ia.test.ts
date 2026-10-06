import { describe, expect, it } from 'vitest'
import { configurarIa } from './ia.ts'

const base = {
  AI_PROVIDER: 'openrouter' as const,
  OPENROUTER_API_KEY: 'sk-or-SEGREDO',
  OPENAI_API_KEY: undefined,
  AI_TRIAGE_MODELS: ['a/modelo:free'],
  AI_INGEST_MODELS: undefined,
  OPENROUTER_BASE_URL: undefined,
  OPENAI_BASE_URL: undefined,
  OPENROUTER_DEV_SEM_ZDR: false,
  NODE_ENV: undefined,
}
const openai = { ...base, AI_PROVIDER: 'openai' as const, OPENROUTER_API_KEY: undefined, OPENAI_API_KEY: 'sk-proj-SEGREDO', AI_TRIAGE_MODELS: ['gpt-4.1-mini'] }

describe('configurarIa (boot do worker e smoke test)', () => {
  it('OpenRouter: chave, base de teste e chave de desenvolvimento sem ZDR passam ao cliente', () => {
    const r = configurarIa({ ...base, OPENROUTER_BASE_URL: 'http://127.0.0.1:1', OPENROUTER_DEV_SEM_ZDR: true }, 'titulo')
    expect(r.cliente).toEqual({ provider: 'openrouter', apiKey: 'sk-or-SEGREDO', appTitle: 'titulo', baseUrl: 'http://127.0.0.1:1', semZdrDev: true })
    expect(r.resumo).toEqual({ provedorIa: 'openrouter', modelosTriagem: ['a/modelo:free'], modelosCardapio: [] })
  })

  it('OpenRouter aceita qualquer nome de modelo (sem tabela de preços: o custo vem da resposta)', () => {
    expect(() => configurarIa({ ...base, AI_INGEST_MODELS: ['x/y'] }, 't')).not.toThrow()
  })

  it('OpenAI: chave e base de teste passam ao cliente; resumo para o log de boot sem segredo', () => {
    const r = configurarIa({ ...openai, OPENAI_BASE_URL: 'http://127.0.0.1:2', AI_INGEST_MODELS: ['gpt-4.1-mini', 'gpt-4.1'] }, 't')
    expect(r.cliente).toEqual({ provider: 'openai', apiKey: 'sk-proj-SEGREDO', baseUrl: 'http://127.0.0.1:2' })
    expect(r.resumo).toEqual({ provedorIa: 'openai', modelosTriagem: ['gpt-4.1-mini'], modelosCardapio: ['gpt-4.1-mini', 'gpt-4.1'] })
    expect(JSON.stringify(r.resumo)).not.toContain('SEGREDO')
  })

  it('OpenAI com modelo fora da tabela (triagem ou cardápio) recusa listando os modelos', () => {
    const fn = () => configurarIa({ ...openai, AI_TRIAGE_MODELS: ['gpt-4.1-mini', 'gpt-9'], AI_INGEST_MODELS: ['nvidia/x:free'] }, 't')
    expect(fn).toThrow(/sem preço cadastrado/)
    expect(fn).toThrow(/gpt-9, nvidia\/x:free/)
    expect(fn).toThrow(/gpt-4\.1-mini/) // lista também os cadastrados
    expect(fn).not.toThrow(/SEGREDO/)
  })

  it('snapshot datado de modelo cadastrado é aceito', () => {
    expect(() => configurarIa({ ...openai, AI_TRIAGE_MODELS: ['gpt-4.1-mini-2025-04-14'] }, 't')).not.toThrow()
  })

  it('sem a chave do provedor (env não validada) falha sem mostrar nada', () => {
    expect(() => configurarIa({ ...openai, OPENAI_API_KEY: undefined }, 't')).toThrow('OPENAI_API_KEY')
    expect(() => configurarIa({ ...base, OPENROUTER_API_KEY: undefined }, 't')).toThrow('OPENROUTER_API_KEY')
  })
})
