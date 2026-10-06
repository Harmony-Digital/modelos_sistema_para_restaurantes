import { describe, expect, it, vi } from 'vitest'
import { createOpenRouterClient } from '@atd/ai'
import { smokeOpenRouter } from './smoke-openrouter.ts'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const resposta = (content: string, model = 'm') =>
  json(200, { model, choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 3, cost: 0.000001 } })
const corpo = (f: ReturnType<typeof vi.fn>, i: number) =>
  JSON.parse(String((f.mock.calls[i]! as unknown as [string, RequestInit])[1].body)) as Record<string, unknown>

const cliente = (f: unknown) => createOpenRouterClient({ apiKey: 'KEY', appTitle: 'smoke', fetch: f as typeof fetch })

describe('smoke test do OpenRouter (mesmo cliente do worker)', () => {
  it('cada modelo sozinho e depois a lista inteira; corpo com deny + zdr + require_parameters e json_schema estrito', async () => {
    const f = vi.fn(async () => resposta('{"ok":true}'))
    const r = await smokeOpenRouter(cliente(f), [['a/1', 'b/2']])
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
    const r = await smokeOpenRouter(cliente(f), [['a/1']])
    expect(r.ok).toBe(false)
    expect(r.linhas[0]).toMatch(/^FALHA a\/1/)
  })

  it('erro do OpenRouter (sem endpoint ZDR, por exemplo) falha com a mensagem do erro', async () => {
    const f = vi.fn(async () => json(404, { error: { code: 404, message: 'No endpoints found matching your data policy' } }))
    const r = await smokeOpenRouter(cliente(f), [['a/1']])
    expect(r.ok).toBe(false)
    expect(r.linhas[0]).toContain('No endpoints found matching your data policy')
  })

  it('lista vazia é falha (variável de modelos ausente)', async () => {
    const r = await smokeOpenRouter(cliente(vi.fn()), [[]])
    expect(r.ok).toBe(false)
  })
})
