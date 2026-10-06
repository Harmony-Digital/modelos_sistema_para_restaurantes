import { z } from 'zod'
import { redactPii, SERVICOS, TIPOS_S1, TIPOS_S2 } from '@atd/core'
import type { JsonCallResult, LlmClient } from './openrouter.ts'
import { TRIAGE_PROMPT_VERSION, triageJsonSchema, triageSystemPrompt } from './prompts/triage-v1.ts'
import { TRIAGE_V2_PROMPT_VERSION, triageV2JsonSchema, triageV2SystemPrompt } from './prompts/triage-v2.ts'
import { TRIAGE_V3_PROMPT_VERSION, triageV3JsonSchema, triageV3SystemPrompt } from './prompts/triage-v3.ts'

export const INTENTS = ['horario_unidades', 'aviso_presenca', 'evento', 'cardapio', 'humano', 'lgpd', 'multiplo', 'fora_escopo'] as const
export type Intent = (typeof INTENTS)[number]

const triageSchema = z.object({ intent: z.enum(INTENTS), confianca: z.number().min(0).max(1) })
export type Triage = z.infer<typeof triageSchema>

export { TRIAGE_PROMPT_VERSION }
export const TRIAGE_BUDGET_ESTIMATE_USD = '0.005'

// impede que o texto do cliente feche a região de dados (<mensagem_cliente>)
const neutralize = (t: string) => t.replaceAll('<', '‹').replaceAll('>', '›')

export function triage(
  llm: LlmClient,
  p: { models: string[]; restaurante: string; text: string },
): Promise<JsonCallResult<Triage>> {
  return llm.completeJson({
    models: p.models,
    system: triageSystemPrompt(p.restaurante),
    user: `<mensagem_cliente>\n${neutralize(redactPii(p.text))}\n</mensagem_cliente>`,
    schemaName: 'triagem',
    jsonSchema: triageJsonSchema,
    parse: (raw) => triageSchema.parse(raw),
    maxTokens: 60,
  })
}

// ------------------------------------------------------------- v2: lista de itens (Etapa 02)

const cortar = (max: number) => z.string().transform((s) => s.slice(0, max)).nullable()
const itemSchema = z
  .object({
    servico: z.enum(SERVICOS),
    tipo: z.enum(TIPOS_S1).nullable(),
    unidade: cortar(120),
    data: cortar(60),
    tema: cortar(120),
  })
  .transform((i) => ({ ...i, pessoas: null, horario: null })) // v2 não extrai avisos de presença
const triageV2Schema = z.object({
  itens: z.array(itemSchema).transform((a) => a.slice(0, 5)),
  fora_escopo: z.boolean(),
})
export type TriageV2 = z.infer<typeof triageV2Schema>
export { TRIAGE_V2_PROMPT_VERSION }

export const parseTriageV2 = (raw: unknown): TriageV2 => triageV2Schema.parse(raw)

export function triageV2(
  llm: LlmClient,
  p: { models: string[]; restaurante: string; text: string },
): Promise<JsonCallResult<TriageV2>> {
  return llm.completeJson({
    models: p.models,
    system: triageV2SystemPrompt(p.restaurante),
    user: `<mensagem_cliente>\n${neutralize(redactPii(p.text))}\n</mensagem_cliente>`,
    schemaName: 'triagem_v2',
    jsonSchema: triageV2JsonSchema,
    parse: parseTriageV2,
    maxTokens: 300,
  })
}

// ------------------------------------------------------------- v3: + avisos de presença (Etapa 03)

const itemV3Schema = z.object({
  servico: z.enum(SERVICOS),
  tipo: z.enum([...TIPOS_S1, ...TIPOS_S2]).nullable(),
  unidade: cortar(120),
  data: cortar(60),
  tema: cortar(120),
  pessoas: z.number().int().min(1).max(60).nullable(),
  horario: cortar(40),
})
const triageV3Schema = z.object({
  itens: z.array(itemV3Schema).transform((a) => a.slice(0, 5)),
  fora_escopo: z.boolean(),
})
export type TriageV3 = z.infer<typeof triageV3Schema>
export { TRIAGE_V3_PROMPT_VERSION }

export const parseTriageV3 = (raw: unknown): TriageV3 => triageV3Schema.parse(raw)

export function triageV3(
  llm: LlmClient,
  p: { models: string[]; restaurante: string; text: string },
): Promise<JsonCallResult<TriageV3>> {
  return llm.completeJson({
    models: p.models,
    system: triageV3SystemPrompt(p.restaurante),
    user: `<mensagem_cliente>\n${neutralize(redactPii(p.text))}\n</mensagem_cliente>`,
    schemaName: 'triagem_v3',
    jsonSchema: triageV3JsonSchema,
    parse: parseTriageV3,
    maxTokens: 400,
  })
}
