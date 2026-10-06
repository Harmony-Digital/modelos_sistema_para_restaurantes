import { parseEnv } from 'node:util'
import type { LlmClient } from '@atd/ai'

const SCHEMA = {
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
  additionalProperties: false,
} as const

/** A OpenAI ecoa parte da chave no 401 ("Incorrect API key provided: sk-proj-****abcd"): nunca imprimir nem esse pedaço. */
const semChave = (texto: string) => texto.replace(/\bsk-[\w*.-]+/g, 'sk-…')

/**
 * Smoke test de produção: usa o MESMO cliente do worker (OpenAI: store:false, json_schema estrito, raciocínio mínimo;
 * OpenRouter: deny + zdr + require_parameters). Para cada lista de modelos, chama cada modelo sozinho e depois a lista
 * inteira (como o worker faz, com reserva entre modelos). Só passa se toda resposta for exatamente {"ok": true}.
 * Nunca imprime a chave; o texto do erro já vem com PII mascarada pelo cliente.
 */
export async function smokeIa(
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
        linhas.push(`FALHA ${nome} — ${semChave(r.error)}${r.status ? ` (HTTP ${r.status})` : ''}${r.model ? ` [modelo ${r.model}]` : ''}`)
      }
    }
  }
  return { ok, linhas }
}

/**
 * Ambiente do smoke test de produção: os valores do `.env.worker-producao` VENCEM os do shell (um `.env` local carregado
 * antes não troca provedor, chave nem modelos — `node --env-file` não sobrescreveria); nunca usa as bases de teste
 * (servidores falsos do e2e) nem a chave de desenvolvimento sem ZDR.
 */
export function ambienteDoSmoke(shell: Record<string, string | undefined>, arquivo: string): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...shell, ...parseEnv(arquivo), OPENROUTER_DEV_SEM_ZDR: '0' }
  delete env.OPENAI_BASE_URL
  delete env.OPENROUTER_BASE_URL
  return env
}
