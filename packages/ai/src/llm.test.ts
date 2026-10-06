import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createLlmClient } from './llm.ts'

const resposta = () =>
  new Response(JSON.stringify({ model: 'm', choices: [{ message: { content: '{}' }, finish_reason: 'stop' }], usage: {} }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const chamar = async (cfg: Parameters<typeof createLlmClient>[0]) => {
  const f = vi.fn(async () => resposta())
  vi.stubGlobal('fetch', f)
  try {
    await createLlmClient(cfg).completeJson({
      models: ['gpt-4.1-mini'], system: 's', user: 'u', schemaName: 'x',
      jsonSchema: { type: 'object' }, parse: (raw) => z.object({}).parse(raw), maxTokens: 10,
    })
  } finally {
    vi.unstubAllGlobals()
  }
  const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
  return { url, body: JSON.parse(String(init.body)) as Record<string, unknown> }
}

describe('createLlmClient', () => {
  it('openai ⇒ cliente da OpenAI (store:false, model único, sem provider)', async () => {
    const { url, body } = await chamar({ provider: 'openai', apiKey: 'k', baseUrl: 'http://falso.test/v1' })
    expect(url).toBe('http://falso.test/v1/chat/completions')
    expect(body.store).toBe(false)
    expect(body.model).toBe('gpt-4.1-mini')
    expect(body).not.toHaveProperty('provider')
  })

  it('openrouter ⇒ cliente do OpenRouter (models + provider deny/zdr)', async () => {
    const { url, body } = await chamar({ provider: 'openrouter', apiKey: 'k', baseUrl: 'http://falso.test/api/v1' })
    expect(url).toBe('http://falso.test/api/v1/chat/completions')
    expect(body.models).toEqual(['gpt-4.1-mini'])
    expect(body.provider).toEqual({ data_collection: 'deny', zdr: true, require_parameters: true })
  })

  it('openrouter com semZdrDev ⇒ sem provider (só dev local)', async () => {
    const { body } = await chamar({ provider: 'openrouter', apiKey: 'k', baseUrl: 'http://falso.test/api/v1', semZdrDev: true })
    expect(body).not.toHaveProperty('provider')
  })
})
