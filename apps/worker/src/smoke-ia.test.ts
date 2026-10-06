import { describe, expect, it, vi } from 'vitest'
import { createOpenAiClient, createOpenRouterClient } from '@atd/ai'
import { ambienteDoSmoke, smokeIa } from './smoke-ia.ts'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const resposta = (content: string, model = 'm') =>
  json(200, { model, choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 3, cost: 0.000001 } })
const corpo = (f: ReturnType<typeof vi.fn>, i: number) =>
  JSON.parse(String((f.mock.calls[i]! as unknown as [string, RequestInit])[1].body)) as Record<string, unknown>

const cliente = (f: unknown) => createOpenRouterClient({ apiKey: 'KEY', appTitle: 'smoke', fetch: f as typeof fetch })

describe('smoke test da IA com o OpenRouter (mesmo cliente do worker)', () => {
  it('cada modelo sozinho e depois a lista inteira; corpo com deny + zdr + require_parameters e json_schema estrito', async () => {
    const f = vi.fn(async () => resposta('{"ok":true}'))
    const r = await smokeIa(cliente(f), [['a/1', 'b/2']])
    expect(r.ok).toBe(true)
    expect(f).toHaveBeenCalledTimes(3)
    expect(corpo(f, 0).models).toEqual(['a/1'])
    expect(corpo(f, 1).models).toEqual(['b/2'])
    expect(corpo(f, 2).models).toEqual(['a/1', 'b/2'])
    for (const i of [0, 1, 2]) {
      expect(corpo(f, i).provider).toEqual({ data_collection: 'deny', zdr: true, require_parameters: true })
      expect(corpo(f, i).response_format).toMatchObject({ type: 'json_schema', json_schema: { strict: true } })
    }
    expect(r.linhas.every((l) => l.startsWith('OK '))).toBe(true)
  })

  it('resposta que não é exatamente {"ok":true} falha (saída ≠ 0 no script)', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(resposta('{"ok":false}'))
      .mockResolvedValue(resposta('{"ok":true}'))
    const r = await smokeIa(cliente(f), [['a/1']])
    expect(r.ok).toBe(false)
    expect(r.linhas[0]).toMatch(/^FALHA a\/1/)
  })

  it('erro do OpenRouter (sem endpoint ZDR, por exemplo) falha com a mensagem do erro', async () => {
    const f = vi.fn(async () => json(404, { error: { code: 404, message: 'No endpoints found matching your data policy' } }))
    const r = await smokeIa(cliente(f), [['a/1']])
    expect(r.ok).toBe(false)
    expect(r.linhas[0]).toContain('No endpoints found matching your data policy')
  })

  it('lista vazia é falha (variável de modelos ausente)', async () => {
    const r = await smokeIa(cliente(vi.fn()), [[]])
    expect(r.ok).toBe(false)
  })
})

const respostaOpenAi = (content: string, model = 'gpt-4.1-mini-2025-04-14') =>
  json(200, { model, choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 4 } })
const clienteOpenAi = (f: unknown) => createOpenAiClient({ apiKey: 'sk-proj-SEGREDO', fetch: f as typeof fetch })

describe('smoke test da IA com a OpenAI (mesmo cliente do worker)', () => {
  it('cada modelo sozinho e depois a lista; corpo com store:false, json_schema estrito e um modelo por chamada', async () => {
    const f = vi.fn(async () => respostaOpenAi('{"ok":true}'))
    const r = await smokeIa(clienteOpenAi(f), [['gpt-4.1-mini', 'gpt-4.1']])
    expect(r.ok).toBe(true)
    expect(f).toHaveBeenCalledTimes(3) // a lista para no primeiro modelo que responde
    expect(corpo(f, 0).model).toBe('gpt-4.1-mini')
    expect(corpo(f, 1).model).toBe('gpt-4.1')
    expect(corpo(f, 2).model).toBe('gpt-4.1-mini')
    for (const i of [0, 1, 2]) {
      expect(corpo(f, i).store).toBe(false)
      expect(corpo(f, i)).not.toHaveProperty('provider')
      expect(corpo(f, i).response_format).toMatchObject({ type: 'json_schema', json_schema: { strict: true } })
    }
    // custo calculado pela tabela (snapshot datado cai no preço do alias)
    expect(r.linhas[0]).toMatch(/^OK gpt-4\.1-mini → gpt-4\.1-mini-2025-04-14 \(US\$ 0\.0000\d+, \d+ ms\)$/)
  })

  it('401: FALHA com HTTP 401 e sem o pedaço da chave que a OpenAI ecoa na mensagem', async () => {
    const f = vi.fn(async () => json(401, { error: { message: 'Incorrect API key provided: sk-proj-****************abcd. You can find your API key at https://platform.openai.com/account/api-keys.', type: 'invalid_request_error', code: 'invalid_api_key' } }))
    const r = await smokeIa(clienteOpenAi(f), [['gpt-4.1-mini']])
    expect(r.ok).toBe(false)
    expect(r.linhas[0]).toMatch(/^FALHA gpt-4\.1-mini — Incorrect API key provided: sk-…/)
    expect(r.linhas[0]).toContain('(HTTP 401)')
    expect(r.linhas.join('\n')).not.toMatch(/abcd|SEGREDO/)
  })

  it('403 de modelo não liberado no projeto e 429 de cota: FALHA com o status e a mensagem da OpenAI', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json(403, { error: { message: 'Project `proj_x` does not have access to model `gpt-4.1`', type: 'invalid_request_error', code: 'model_not_found' } }))
      .mockResolvedValueOnce(json(429, { error: { message: 'You exceeded your current quota, please check your plan and billing details.', type: 'insufficient_quota', code: 'insufficient_quota' } }))
    const r = await smokeIa(clienteOpenAi(f), [['gpt-4.1'], ['gpt-4.1-mini']])
    expect(r.ok).toBe(false)
    expect(r.linhas[0]).toBe('FALHA gpt-4.1 — Project `proj_x` does not have access to model `gpt-4.1` (HTTP 403)')
    expect(r.linhas[1]).toBe('FALHA gpt-4.1-mini — You exceeded your current quota, please check your plan and billing details. (HTTP 429)')
  })

  it('resposta recusada (refusal) ou fora do esperado: FALHA saida_invalida', async () => {
    const f = vi.fn(async () => json(200, { model: 'gpt-4.1-mini', choices: [{ message: { content: null, refusal: 'não posso' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }))
    const r = await smokeIa(clienteOpenAi(f), [['gpt-4.1-mini']])
    expect(r.ok).toBe(false)
    expect(r.linhas[0]).toMatch(/^FALHA gpt-4\.1-mini — saida_invalida/)
  })
})


describe('ambiente do smoke test de produção', () => {
  it('o arquivo vence o shell; nunca usa base de teste nem a chave de desenvolvimento sem ZDR', () => {
    const env = ambienteDoSmoke(
      { AI_TRIAGE_MODELS: 'nvidia/x:free', OPENAI_BASE_URL: 'http://127.0.0.1:1', OPENROUTER_BASE_URL: 'http://127.0.0.1:2', OPENROUTER_DEV_SEM_ZDR: '1', PATH: '/bin' },
      'AI_PROVIDER=openai\nOPENAI_API_KEY=sk-proj-x\nAI_TRIAGE_MODELS=gpt-4.1-mini\n',
    )
    expect(env).toMatchObject({ AI_PROVIDER: 'openai', AI_TRIAGE_MODELS: 'gpt-4.1-mini', OPENROUTER_DEV_SEM_ZDR: '0', PATH: '/bin' })
    expect(env.OPENAI_BASE_URL).toBeUndefined()
    expect(env.OPENROUTER_BASE_URL).toBeUndefined()
  })
})
