import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createOpenRouterClient } from './openrouter.ts'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const erro = async (status: number, body: unknown) => {
  const r = await createOpenRouterClient({ apiKey: 'KEY', appTitle: 'Atendimento', fetch: async () => json(status, body) }).completeJson({
    models: ['m'], system: 's', user: 'u', schemaName: 'x',
    jsonSchema: { type: 'object' }, parse: (raw) => z.object({}).parse(raw), maxTokens: 10,
  })
  if (r.ok) throw new Error('esperava falha')
  return r
}

describe('mensagem de erro do OpenRouter', () => {
  it('política de dados: diz qual etapa do roteamento barrou', async () => {
    const r = await erro(404, {
      error: {
        message: 'No endpoints found matching your data policy (Zero data retention). Configure: https://openrouter.ai/settings/privacy',
        code: 404,
        metadata: { routing_funnel: [{ step: 'Initial Endpoints', endpoint_count: 1 }], failed_routing_step: 'Filter by Data Policy' },
      },
    })
    expect(r.error).toBe(
      'No endpoints found matching your data policy (Zero data retention). Configure: https://openrouter.ai/settings/privacy [etapa: Filter by Data Policy]',
    )
    expect(r.status).toBe(404)
  })

  it('erro do provedor: mostra o provedor e o motivo real em vez de "Provider returned error"', async () => {
    const r = await erro(400, {
      error: {
        message: 'Provider returned error',
        code: 400,
        metadata: {
          raw: JSON.stringify({ code: 400, reason: 'INVALID_REQUEST_BODY', message: "Model 'apodex/apodex-1.1-mini' does not support 'json_schema' response format. Supported formats: json_object.", metadata: {} }),
          provider_name: 'Novita',
        },
      },
    })
    expect(r.error).toBe(
      "Provider returned error [Novita: Model 'apodex/apodex-1.1-mini' does not support 'json_schema' response format. Supported formats: json_object.]",
    )
  })

  it('raw que não é JSON entra como texto; dado pessoal é mascarado; tamanho limitado', async () => {
    const r = await erro(400, {
      error: { message: 'Provider returned error', metadata: { raw: `entrada inválida para maria@exemplo.com ${'x'.repeat(1000)}`, provider_name: 'P' } },
    })
    expect(r.error).toContain('[P: entrada inválida para [EMAIL] ')
    expect(r.error).not.toContain('maria@exemplo.com')
    expect(r.error.length).toBeLessThanOrEqual(400)
  })

  it('sem metadata: só a mensagem; sem corpo: HTTP status', async () => {
    expect((await erro(429, { error: { message: 'Rate limit exceeded' } })).error).toBe('Rate limit exceeded')
    expect((await erro(502, {})).error).toBe('HTTP 502')
  })
})
