import { afterEach, describe, expect, it, vi } from 'vitest'
import { ambienteDoEvalProd, clienteDoEval, EVALS_PROD } from './provedor.ts'

const SCHEMA = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false }
const ok = (model: string) =>
  new Response(JSON.stringify({ model, choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2 } }), { status: 200 })

async function chamar(llm: ReturnType<typeof clienteDoEval>['llm'], modelo: string) {
  return llm.completeJson({ models: [modelo], system: 's', user: 'u', schemaName: 'smoke', jsonSchema: SCHEMA, parse: (r) => r, maxTokens: 10 })
}

afterEach(() => vi.unstubAllGlobals())

describe('clienteDoEval (provedor dos evals por AI_PROVIDER ou --provider)', () => {
  it('sem AI_PROVIDER nem --provider: OpenRouter com deny + zdr (env local antigo)', async () => {
    const f = vi.fn(async () => ok('m'))
    vi.stubGlobal('fetch', f)
    const { llm, provedor } = clienteDoEval({ env: { OPENROUTER_API_KEY: 'k' }, modelos: ['a/b'] })
    expect(provedor).toBe('openrouter')
    await chamar(llm, 'a/b')
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('openrouter.ai')
    expect(JSON.parse(String(init.body)).provider).toMatchObject({ data_collection: 'deny', zdr: true })
  })

  it('--provider openai vence AI_PROVIDER; store:false, base de teste e custo pela tabela', async () => {
    const f = vi.fn(async () => ok('gpt-4.1-mini'))
    vi.stubGlobal('fetch', f)
    const { llm, provedor } = clienteDoEval({
      provider: 'openai',
      env: { AI_PROVIDER: 'openrouter', OPENAI_API_KEY: 'sk-proj-x', OPENAI_BASE_URL: 'http://127.0.0.1:9/v1' },
      modelos: ['gpt-4.1-mini'],
    })
    expect(provedor).toBe('openai')
    const r = await chamar(llm, 'gpt-4.1-mini')
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:9/v1/chat/completions')
    const corpo = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(corpo.store).toBe(false)
    expect(corpo).not.toHaveProperty('provider')
    expect(r.ok && r.usage.costUsd).not.toBeNull()
  })

  it('AI_PROVIDER=openai sem flag também usa a OpenAI', () => {
    expect(clienteDoEval({ env: { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'k' }, modelos: ['gpt-4.1'] }).provedor).toBe('openai')
  })

  it('sem a chave do provedor escolhido: erro com o nome da variável', () => {
    expect(() => clienteDoEval({ provider: 'openai', env: { OPENROUTER_API_KEY: 'k' }, modelos: ['gpt-4.1'] })).toThrow('OPENAI_API_KEY')
    expect(() => clienteDoEval({ env: { OPENAI_API_KEY: 'k' }, modelos: ['a/b'] })).toThrow('OPENROUTER_API_KEY')
  })

  it('OpenAI com modelo sem preço: recusa antes de gastar (o teto do eval precisa do custo)', () => {
    expect(() => clienteDoEval({ provider: 'openai', env: { OPENAI_API_KEY: 'k' }, modelos: ['gpt-4.1-mini', 'nvidia/x:free'] })).toThrow(/sem preço cadastrado.*nvidia\/x:free/)
  })

  it('provedor desconhecido é recusado', () => {
    expect(() => clienteDoEval({ provider: 'azure', env: { OPENAI_API_KEY: 'k' }, modelos: ['gpt-4.1'] })).toThrow('--provider')
  })
})

describe('eval:prod', () => {
  it('roda S1–S4 e frustração', () => {
    expect(EVALS_PROD.map((e) => e.nome)).toEqual(['s1', 's2', 's3', 's4', 'frustracao'])
  })

  it('o arquivo de produção vence o shell (um .env local carregado não troca os modelos) e força a OpenAI', () => {
    const env = ambienteDoEvalProd(
      { AI_TRIAGE_MODELS: 'nvidia/x:free', AI_PROVIDER: 'openrouter', PATH: '/bin' },
      'AI_PROVIDER=openrouter\nOPENAI_API_KEY=sk-proj-x\nAI_TRIAGE_MODELS=gpt-4.1-mini\n',
    )
    expect(env).toMatchObject({ AI_PROVIDER: 'openai', AI_TRIAGE_MODELS: 'gpt-4.1-mini', OPENAI_API_KEY: 'sk-proj-x', PATH: '/bin' })
  })

  it('não aponta a base da OpenAI para outro lugar em produção', () => {
    const env = ambienteDoEvalProd({ OPENAI_BASE_URL: 'http://127.0.0.1:1' }, 'OPENAI_API_KEY=k\nAI_TRIAGE_MODELS=gpt-4.1-mini\n')
    expect(env.OPENAI_BASE_URL).toBeUndefined()
  })
})
