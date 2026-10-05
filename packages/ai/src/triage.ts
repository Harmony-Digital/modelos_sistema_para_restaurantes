import { z } from 'zod'
import { redactPii } from '@atd/core'
import type { JsonCallResult, LlmClient } from './openrouter.ts'
import { TRIAGE_PROMPT_VERSION, triageJsonSchema, triageSystemPrompt } from './prompts/triage-v1.ts'

export const INTENTS = ['horario_unidades', 'aviso_presenca', 'evento', 'cardapio', 'humano', 'lgpd', 'multiplo', 'fora_escopo'] as const
export type Intent = (typeof INTENTS)[number]

const triageSchema = z.object({ intent: z.enum(INTENTS), confianca: z.number().min(0).max(1) })
export type Triage = z.infer<typeof triageSchema>

export { TRIAGE_PROMPT_VERSION }
export const TRIAGE_BUDGET_ESTIMATE_USD = '0.005'

export function triage(
  llm: LlmClient,
  p: { models: string[]; restaurante: string; text: string },
): Promise<JsonCallResult<Triage>> {
  return llm.completeJson({
    models: p.models,
    system: triageSystemPrompt(p.restaurante),
    user: `<mensagem_cliente>\n${redactPii(p.text)}\n</mensagem_cliente>`,
    schemaName: 'triagem',
    jsonSchema: triageJsonSchema,
    parse: (raw) => triageSchema.parse(raw),
    maxTokens: 60,
  })
}
