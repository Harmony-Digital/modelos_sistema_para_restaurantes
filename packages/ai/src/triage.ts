import { z } from 'zod'
import { redactPii, SERVICOS, TAGS_CARDAPIO, TIPOS_S1, TIPOS_S2, TIPOS_S3, TIPOS_S4 } from '@atd/core'
import type { JsonCallResult, LlmClient } from './openrouter.ts'
import { TRIAGE_PROMPT_VERSION, triageJsonSchema, triageSystemPrompt } from './prompts/triage-v1.ts'
import { TRIAGE_V2_PROMPT_VERSION, triageV2JsonSchema, triageV2SystemPrompt } from './prompts/triage-v2.ts'
import { TRIAGE_V3_PROMPT_VERSION, triageV3JsonSchema, triageV3SystemPrompt } from './prompts/triage-v3.ts'
import { TRIAGE_V4_PROMPT_VERSION, triageV4JsonSchema, triageV4SystemPrompt } from './prompts/triage-v4.ts'
import { TRIAGE_V5_PROMPT_VERSION, triageV5JsonSchema, triageV5SystemPrompt } from './prompts/triage-v5.ts'

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
  // v2 não extrai avisos de presença nem eventos
  .transform((i) => ({ ...i, pessoas: null, horario: null, convidados: null, tipoEvento: null, espaco: null, consulta: null, tag: null }))
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

/** Contagem de 1 a `max` ou null; 0 ou negativo vira null (o core pergunta de novo) em vez de derrubar a triagem inteira. */
const contagem = (max: number) =>
  z.preprocess((v) => (typeof v === 'number' && v <= 0 ? null : v), z.number().int().min(1).max(max).nullable())

const itemV3Schema = z.object({
  servico: z.enum(SERVICOS),
  tipo: z.enum([...TIPOS_S1, ...TIPOS_S2]).nullable(),
  unidade: cortar(120),
  data: cortar(60),
  tema: cortar(120),
  // acima de 60 passa: o core responde o limite (aviso_pessoas_invalido) em vez de virar saída inválida
  pessoas: contagem(1000),
  horario: cortar(40),
}).transform((i) => ({ ...i, convidados: null, tipoEvento: null, espaco: null, consulta: null, tag: null })) // v3 não extrai eventos nem cardápio
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

// ------------------------------------------------------------- v4: + eventos e pergunta pendente (Etapa 04)

const itemV4Schema = z.object({
  servico: z.enum(SERVICOS),
  tipo: z.enum([...TIPOS_S1, ...TIPOS_S2, ...TIPOS_S3]).nullable(),
  unidade: cortar(120),
  data: cortar(60),
  tema: cortar(120),
  pessoas: contagem(1000),
  horario: cortar(40),
  // acima de 1000 passa: o core responde o limite (evento_convidados_invalido)
  convidados: contagem(10000),
  tipoEvento: cortar(60),
  espaco: cortar(60), // "*" = o cliente disse que tanto faz
}).transform((i) => ({ ...i, consulta: null, tag: null })) // v4 não extrai cardápio
const triageV4Schema = z.object({
  itens: z.array(itemV4Schema).transform((a) => a.slice(0, 5)),
  fora_escopo: z.boolean(),
})
export type TriageV4 = z.infer<typeof triageV4Schema>
export { TRIAGE_V4_PROMPT_VERSION }

export const parseTriageV4 = (raw: unknown): TriageV4 => triageV4Schema.parse(raw)

/** Pergunta que fizemos ao cliente (texto nosso) e o que já foi validado do pedido (sem texto livre do cliente). */
export type PendenteTriagem = { pergunta: string; conhecido: Record<string, string | number> }

/** Bloco da pergunta pendente (v4 e v5) seguido da mensagem do cliente, cada um delimitado e neutralizado. */
function userComPendente(text: string, pendente?: PendenteTriagem): string {
  const blocoPendente = pendente
    ? `<pergunta_pendente>\n${neutralize(pendente.pergunta)}\n</pergunta_pendente>\n<pedido_em_andamento>\n${neutralize(JSON.stringify(pendente.conhecido))}\n</pedido_em_andamento>\n`
    : ''
  return `${blocoPendente}<mensagem_cliente>\n${neutralize(redactPii(text))}\n</mensagem_cliente>`
}

export function triageV4(
  llm: LlmClient,
  p: { models: string[]; restaurante: string; text: string; pendente?: PendenteTriagem },
): Promise<JsonCallResult<TriageV4>> {
  return llm.completeJson({
    models: p.models,
    system: triageV4SystemPrompt(p.restaurante),
    user: userComPendente(p.text, p.pendente),
    schemaName: 'triagem_v4',
    jsonSchema: triageV4JsonSchema,
    parse: parseTriageV4,
    maxTokens: 450,
  })
}

// ------------------------------------------------------------- v5: + cardápio e mudança de pedido de evento (Etapa 05)

const itemV5Schema = z.object({
  servico: z.enum(SERVICOS),
  tipo: z.enum([...TIPOS_S1, ...TIPOS_S2, ...TIPOS_S3, ...TIPOS_S4]).nullable(),
  unidade: cortar(120),
  data: cortar(60),
  tema: cortar(120), // em evento, "mudanca" = o cliente quer mudar um pedido (o core reconhece com ditaComoMudanca)
  pessoas: contagem(1000),
  horario: cortar(40),
  convidados: contagem(10000),
  tipoEvento: cortar(60),
  espaco: cortar(60),
  consulta: cortar(60),
  // tag fora da lista vira null em vez de derrubar a triagem (o core cai para busca ou envio)
  tag: z.enum(TAGS_CARDAPIO).nullable().catch(null),
})
const triageV5Schema = z.object({
  itens: z.array(itemV5Schema).transform((a) => a.slice(0, 5)),
  fora_escopo: z.boolean(),
})
export type TriageV5 = z.infer<typeof triageV5Schema>
export { TRIAGE_V5_PROMPT_VERSION }

export const parseTriageV5 = (raw: unknown): TriageV5 => triageV5Schema.parse(raw)

export function triageV5(
  llm: LlmClient,
  p: { models: string[]; restaurante: string; text: string; pendente?: PendenteTriagem },
): Promise<JsonCallResult<TriageV5>> {
  return llm.completeJson({
    models: p.models,
    system: triageV5SystemPrompt(p.restaurante),
    user: userComPendente(p.text, p.pendente),
    schemaName: 'triagem_v5',
    jsonSchema: triageV5JsonSchema,
    parse: parseTriageV5,
    maxTokens: 500,
  })
}
