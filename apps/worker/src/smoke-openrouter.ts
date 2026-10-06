import type { LlmClient } from '@atd/ai'

const SCHEMA = {
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
  additionalProperties: false,
} as const

/**
 * Smoke test de produção: usa o MESMO cliente do worker (deny + zdr + require_parameters, json_schema estrito,
 * reasoning desligado com a repetição do cliente). Para cada lista de modelos, chama cada modelo sozinho e depois
 * a lista inteira (como o worker faz). Só passa se toda resposta for exatamente {"ok": true}.
 * Nunca imprime a chave; o texto do erro já vem com PII mascarada pelo cliente.
 */
export async function smokeOpenRouter(
  client: LlmClient,
  listas: readonly (readonly string[])[],
): Promise<{ ok: boolean; linhas: string[] }> {
  const linhas: string[] = []
  let ok = true
  for (const lista of listas) {
    if (!lista.length) {
      linhas.push('FALHA lista de modelos vazia — confira AI_TRIAGE_MODELS e AI_INGEST_MODELS')
      ok = false
      continue
    }
    const pedidos = lista.length > 1 ? [...lista.map((m) => [m]), [...lista]] : [[...lista]]
    for (const models of pedidos) {
      const nome = models.join(',')
      const r = await client.completeJson({
        models,
        system: 'Você é um teste de conectividade. Responda só com o JSON pedido.',
        user: 'Responda exatamente {"ok": true}.',
        schemaName: 'smoke',
        jsonSchema: SCHEMA as unknown as Record<string, unknown>,
        parse: (raw) => {
          if (typeof raw !== 'object' || raw === null || (raw as { ok?: unknown }).ok !== true || Object.keys(raw).length !== 1) {
            throw new Error('resposta diferente de {"ok":true}')
          }
          return raw as { ok: true }
        },
        maxTokens: 50,
      })
      if (r.ok) {
        linhas.push(`OK ${nome} → ${r.model} (US$ ${r.usage.costUsd ?? '?'}, ${r.latencyMs} ms)`)
      } else {
        ok = false
        linhas.push(`FALHA ${nome} — ${r.error}${r.status ? ` (HTTP ${r.status})` : ''}${r.model ? ` [modelo ${r.model}]` : ''}`)
      }
    }
  }
  return { ok, linhas }
}
