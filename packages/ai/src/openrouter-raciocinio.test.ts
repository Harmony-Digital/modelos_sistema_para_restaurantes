import { describe, expect, it, vi } from 'vitest'
import { createOpenRouterClient } from './openrouter.ts'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const ok = () => json(200, { model: 'm', choices: [{ message: { content: '{"a":1}' } }] })

const chamar = (f: typeof fetch, reasoning?: boolean) =>
  createOpenRouterClient({ apiKey: 'KEY', appTitle: 'A', fetch: f }).completeJson({
    models: ['m'], system: 'sys', user: 'u', schemaName: 'x', jsonSchema: { type: 'object' }, parse: (raw) => raw, maxTokens: 50,
    ...(reasoning === undefined ? {} : { reasoning }),
  })
const corpo = (f: ReturnType<typeof vi.fn>, i = 0) =>
  JSON.parse(String((f.mock.calls[i]! as unknown as [string, RequestInit])[1].body)) as Record<string, unknown>

describe('OpenRouter completeJson — raciocínio', () => {
  it('padrão: desliga o raciocínio (modelo de raciocínio não gasta max_tokens pensando e devolve content null)', async () => {
    const f = vi.fn(async () => ok())
    expect((await chamar(f)).ok).toBe(true)
    expect(corpo(f).reasoning).toEqual({ enabled: false })
  })

  it('reasoning: true não manda o campo (o provedor decide; leitura de documento)', async () => {
    const f = vi.fn(async () => ok())
    await chamar(f, true)
    expect(corpo(f)).not.toHaveProperty('reasoning')
  })

  it('modelo com raciocínio obrigatório recusa o desligamento (400): repete uma vez sem o campo', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json(400, { error: { code: 400, message: 'Reasoning is mandatory for this endpoint and cannot be disabled.' } }))
      .mockResolvedValueOnce(ok())
    const r = await chamar(f as unknown as typeof fetch)
    expect(r.ok).toBe(true)
    expect(f).toHaveBeenCalledTimes(2)
    expect(corpo(f, 0).reasoning).toEqual({ enabled: false })
    expect(corpo(f, 1)).not.toHaveProperty('reasoning')
    expect(corpo(f, 1).provider).toEqual({ data_collection: 'deny', zdr: true, require_parameters: true })
  })

  it('require_parameters sem endpoint que aceite o reasoning (404 "No endpoints found…parameters"): repete uma vez sem reasoning, mantendo deny + zdr + require_parameters', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json(404, { error: { code: 404, message: 'No endpoints found that can handle the requested parameters.' } }))
      .mockResolvedValueOnce(ok())
    const r = await chamar(f as unknown as typeof fetch)
    expect(r.ok).toBe(true)
    expect(f).toHaveBeenCalledTimes(2)
    expect(corpo(f, 0).reasoning).toEqual({ enabled: false })
    expect(corpo(f, 0).provider).toEqual({ data_collection: 'deny', zdr: true, require_parameters: true })
    expect(corpo(f, 1)).not.toHaveProperty('reasoning')
    expect(corpo(f, 1).provider).toEqual({ data_collection: 'deny', zdr: true, require_parameters: true })
    expect(corpo(f, 1).response_format).toEqual(corpo(f, 0).response_format)
  })

  it('400 de parâmetro não suportado também repete uma vez sem reasoning', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json(400, { error: { code: 400, message: 'Provider does not support the requested parameters' } }))
      .mockResolvedValueOnce(ok())
    expect((await chamar(f as unknown as typeof fetch)).ok).toBe(true)
    expect(f).toHaveBeenCalledTimes(2)
    expect(corpo(f, 1)).not.toHaveProperty('reasoning')
  })

  it('404 de parâmetros que persiste sem reasoning: só uma repetição, falha permanente', async () => {
    const f = vi.fn(async () => json(404, { error: { code: 404, message: 'No endpoints found that can handle the requested parameters.' } }))
    const r = await chamar(f)
    expect(r).toMatchObject({ ok: false, retryable: false, status: 404 })
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('reasoning: true (sem o campo) não repete no 404 de parâmetros', async () => {
    const f = vi.fn(async () => json(404, { error: { code: 404, message: 'No endpoints found that can handle the requested parameters.' } }))
    await chamar(f, true)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('404 de política de dados (ZDR) não repete: o reasoning não é a causa', async () => {
    const f = vi.fn(async () => json(404, { error: { code: 404, message: 'No endpoints found matching your data policy (Zero data retention).' } }))
    await chamar(f)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('outro 400 não repete', async () => {
    const f = vi.fn(async () => json(400, { error: { code: 400, message: 'invalid schema' } }))
    const r = await chamar(f)
    expect(r).toMatchObject({ ok: false, retryable: false, status: 400 })
    expect(f).toHaveBeenCalledTimes(1)
  })
})
