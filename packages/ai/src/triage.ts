import { z } from 'zod'
import { redactPii, SERVICOS, TAGS_CARDAPIO, TIPOS_S1, TIPOS_S2, TIPOS_S3, TIPOS_S4 } from '@atd/core'
import type { JsonCallResult, LlmClient } from './openrouter.ts'
import { TRIAGE_PROMPT_VERSION, triageJsonSchema, triageSystemPrompt } from './prompts/triage-v1.ts'
import { TRIAGE_V2_PROMPT_VERSION, triageV2JsonSchema, triageV2SystemPrompt } from './prompts/triage-v2.ts'
import { TRIAGE_V3_PROMPT_VERSION, triageV3JsonSchema, triageV3SystemPrompt } from './prompts/triage-v3.ts'
import { TRIAGE_V4_PROMPT_VERSION, triageV4JsonSchema, triageV4SystemPrompt } from './prompts/triage-v4.ts'
import { TRIAGE_V5_PROMPT_VERSION, triageV5JsonSchema, triageV5SystemPrompt } from './prompts/triage-v5.ts'
import { TRIAGE_V6_PROMPT_VERSION, triageV6JsonSchema, triageV6SystemPrompt } from './prompts/triage-v6.ts'
import { TRIAGE_V7_PROMPT_VERSION, triageV7JsonSchema, triageV7SystemPrompt } from './prompts/triage-v7.ts'

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

/** Bloco da pergunta pendente (v4 a v7) seguido da mensagem do cliente, cada um delimitado e neutralizado. */
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
  tema: cortar(120), // em evento (e na reserva da v7), "mudanca" = o cliente quer mudar o que já pediu (o core reconhece com ditaComoMudanca)
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

// ------------------------------------------------------------- v6: + frustração com o atendimento (Etapa 06)

const triageV6Schema = z.object({
  itens: z.array(itemV5Schema).transform((a) => a.slice(0, 5)),
  fora_escopo: z.boolean(),
  // obrigatório: ausente = saída inválida (o handoff por frustração depende dele)
  frustracao: z.boolean(),
})
export type TriageV6 = z.infer<typeof triageV6Schema>
export { TRIAGE_V6_PROMPT_VERSION }

export const parseTriageV6 = (raw: unknown): TriageV6 => triageV6Schema.parse(raw)

/** Triagem que o worker usa a partir da Etapa 06: itens da v5 + `frustracao` da mensagem inteira. */
export function triageV6(
  llm: LlmClient,
  p: { models: string[]; restaurante: string; text: string; pendente?: PendenteTriagem },
): Promise<JsonCallResult<TriageV6>> {
  return llm.completeJson({
    models: p.models,
    system: triageV6SystemPrompt(p.restaurante),
    user: userComPendente(p.text, p.pendente),
    schemaName: 'triagem_v6',
    jsonSchema: triageV6JsonSchema,
    parse: parseTriageV6,
    maxTokens: 520,
  })
}

// ------------------------------------------------------------- v7: + reserva (nome e resposta do contato)

/** Marcador da redação de PII ([TELEFONE], [CPF]...), em qualquer caixa e com acento: nunca é nome de reserva. */
const MARCADOR_PII = /\[\p{L}+\]/u
const nomeReserva = z
  .string()
  .nullable()
  .transform((s) => {
    const t = s?.trim().slice(0, 80) ?? ''
    return t === '' || MARCADOR_PII.test(t) ? null : t
  })

const itemV7Schema = itemV5Schema
  .extend({
    nome: nomeReserva,
    // resposta a "Posso usar este número do WhatsApp...?": true = sim, false = não/outro número, null = não respondeu
    contato_ok: z.boolean().nullable(),
  })
  // nome e contato só existem na reserva; em outro serviço viram null (o nome não vaza para outro fluxo)
  .transform((i) => (i.servico === 'aviso_presenca' ? i : { ...i, nome: null, contato_ok: null }))
const triageV7Schema = z.object({
  itens: z.array(itemV7Schema).transform((a) => a.slice(0, 5)),
  fora_escopo: z.boolean(),
  frustracao: z.boolean(),
})
export type TriageV7 = z.infer<typeof triageV7Schema>
export type ItemTriagemV7 = TriageV7['itens'][number]
export { TRIAGE_V7_PROMPT_VERSION }

export const parseTriageV7 = (raw: unknown): TriageV7 => triageV7Schema.parse(raw)

/** Triagem da reserva: itens da v6 + `nome` e `contato_ok` na reserva. O horário volta como o cliente disse (o core normaliza). */
export function triageV7(
  llm: LlmClient,
  p: { models: string[]; restaurante: string; text: string; pendente?: PendenteTriagem },
): Promise<JsonCallResult<TriageV7>> {
  return llm.completeJson({
    models: p.models,
    system: triageV7SystemPrompt(p.restaurante),
    user: userComPendente(p.text, p.pendente),
    schemaName: 'triagem_v7',
    jsonSchema: triageV7JsonSchema,
    parse: parseTriageV7,
    maxTokens: 600,
  })
}
