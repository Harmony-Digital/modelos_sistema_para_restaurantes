import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createOpenRouterClient } from './openrouter.ts'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const okBody = (content: string) => ({
  model: 'barato/modelo-1',
  choices: [{ message: { role: 'assistant', content } }],
  usage: { prompt_tokens: 120, completion_tokens: 8, prompt_tokens_details: { cached_tokens: 100 }, cost: 0.000178 },
})

const call = (f: typeof fetch) =>
  createOpenRouterClient({ apiKey: 'KEY', appTitle: 'Atendimento', fetch: f }).completeJson({
    models: ['barato/modelo-1', 'outro/modelo-2'],
    system: 'sys',
    user: 'usr',
    schemaName: 'x',
    jsonSchema: { type: 'object', properties: { a: { type: 'number' } }, required: ['a'], additionalProperties: false },
    parse: (raw) => z.object({ a: z.number() }).parse(raw),
    maxTokens: 50,
  })

describe('OpenRouter completeJson', () => {
  it('monta a requisição com privacidade, fallback e schema estrito', async () => {
    const f = vi.fn(async () => json(200, okBody('{"a":1}')))
    await call(f)
    const [url, init] = f.mock.calls[0]! as unknown as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer KEY')
    const body = JSON.parse(String(init.body))
    expect(body.models).toEqual(['barato/modelo-1', 'outro/modelo-2'])
    expect(body.provider).toEqual({ data_collection: 'deny', zdr: true })
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'x', strict: true, schema: expect.any(Object) },
    })
    expect(body.temperature).toBe(0)
    expect(body.max_tokens).toBe(50)
    expect(body.stream).toBe(false)
  })

  it('sucesso: dado validado, modelo usado e custo exato em string', async () => {
    const r = await call(async () => json(200, okBody('{"a":1}')))
    expect(r).toMatchObject({
      ok: true,
      data: { a: 1 },
      model: 'barato/modelo-1',
      usage: { tokensIn: 120, tokensOut: 8, tokensCache: 100, costUsd: '0.000178' },
    })
  })

  it('saída fora do schema: falha temporária com uso registrado', async () => {
    const r = await call(async () => json(200, okBody('{"b":"x"}')))
    expect(r).toMatchObject({ ok: false, error: 'saida_invalida', retryable: true, usage: { costUsd: '0.000178' } })
  })

  it('402 (crédito/guardrail) é permanente', async () => {
    const r = await call(async () => json(402, { error: { code: 402, message: 'no credits' } }))
    expect(r).toMatchObject({ ok: false, retryable: false, status: 402 })
  })

  it('5xx e rede são temporários', async () => {
    expect(await call(async () => json(502, {}))).toMatchObject({ ok: false, retryable: true, status: 502 })
    expect(await call(async () => { throw new TypeError('fetch failed') })).toMatchObject({ ok: false, retryable: true, status: null })
  })

  it('corpo null com 200 não lança', async () => {
    const r = await call(async () => json(200, null))
    expect(r).toMatchObject({ ok: false, error: 'saida_invalida', retryable: true })
  })

  it('custo: string numérica, ausente, negativo, NaN e minúsculo', async () => {
    const withCost = (cost: unknown) => async () =>
      json(200, { ...okBody('{"a":1}'), usage: { prompt_tokens: 1, completion_tokens: 1, cost } })
    expect(await call(withCost('0.0001'))).toMatchObject({ ok: true, usage: { costUsd: '0.000100' } })
    expect(await call(withCost(undefined))).toMatchObject({ ok: true, usage: { costUsd: null } })
    expect(await call(withCost(-1))).toMatchObject({ ok: true, usage: { costUsd: null } })
    expect(await call(withCost('abc'))).toMatchObject({ ok: true, usage: { costUsd: null } })
    expect(await call(withCost(0))).toMatchObject({ ok: true, usage: { costUsd: '0.000000' } })
    expect(await call(withCost(1e-7))).toMatchObject({ ok: true, usage: { costUsd: '0.000001' } })
  })

  it('sucesso sem usage: tokens zero e custo desconhecido', async () => {
    const r = await call(async () => json(200, { model: 'm', choices: [{ message: { content: '{"a":1}' } }] }))
    expect(r).toMatchObject({ ok: true, usage: { tokensIn: 0, tokensOut: 0, tokensCache: 0, costUsd: null } })
  })

  it('408 e 429 são temporários; 401 é permanente', async () => {
    expect(await call(async () => json(408, {}))).toMatchObject({ retryable: true, status: 408 })
    expect(await call(async () => json(429, {}))).toMatchObject({ retryable: true, status: 429 })
    expect(await call(async () => json(401, {}))).toMatchObject({ retryable: false, status: 401 })
  })
})
