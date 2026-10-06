import { z } from 'zod'
import { LIMITES_RASCUNHO, rascunhoSchema, TAGS_CARDAPIO, type ItemRascunho, type RascunhoCardapio } from '@atd/core'
import type { ConteudoUsuario, JsonCallResult, LlmClient } from './openrouter.ts'
import { INGESTAO_PROMPT_VERSION, ingestaoJsonSchema, ingestaoSystemPrompt } from './prompts/ingestao-cardapio-v1.ts'

export { INGESTAO_PROMPT_VERSION }
/** Reserva de orçamento por leitura de documento (PDF/imagem cobra como tokens de entrada; ajustar com o eval:ingestao). */
export const INGESTAO_BUDGET_ESTIMATE_USD = '0.10'
/**
 * Teto de saída da leitura (~50 tokens por item no JSON: cabe um cardápio de ~300 itens). Acima disso a saída é
 * cortada (`saida_truncada`, sem repetir) e o painel pede o cardápio em partes — lotes por página ficam para a Etapa 07.
 */
export const INGESTAO_MAX_TOKENS = 16_000
/** Leitura de documento demora bem mais que a triagem. */
export const INGESTAO_TIMEOUT_MS = 120_000

const L = LIMITES_RASCUNHO
export const MIMES_IMAGEM_INGESTAO = ['image/png', 'image/jpeg', 'image/webp'] as const

// Saída do modelo: tipos conferidos aqui; tamanhos e limites são ajustados (cortados) antes do rascunhoSchema,
// para um texto longo não derrubar a importação inteira. Tipo errado continua sendo saída inválida.
const itemLidoSchema = z.object({
  nome: z.string(),
  descricao: z.string().nullable(),
  precoCentavos: z.number().nullable(),
  tags: z.array(z.string()),
  unidade: z.string().nullable(),
})
const leituraSchema = z.object({
  categorias: z.array(z.object({ nome: z.string(), itens: z.array(itemLidoSchema) })),
})

const cortar = (s: string | null, max: number): string | null => {
  const t = s?.trim().slice(0, max).trim()
  return t ? t : null
}
/** Preço fora do formato (negativo, fracionário, acima do limite) vira null: a equipe revisa no rascunho. */
const preco = (p: number | null): number | null => (p !== null && Number.isInteger(p) && p >= 0 && p <= L.precoMax ? p : null)
const TAGS = new Set<string>(TAGS_CARDAPIO)

/** Saída do modelo ⇒ RascunhoCardapio validado (incluir = true; outros nomes ficam para a revisão humana). */
export function parseLeituraCardapio(raw: unknown): RascunhoCardapio {
  const lida = leituraSchema.parse(raw)
  let restantes: number = L.itens
  const categorias: RascunhoCardapio['categorias'] = []
  for (const c of lida.categorias) {
    if (categorias.length >= L.categorias || restantes <= 0) break
    const nome = cortar(c.nome, L.nome) ?? 'Outros'
    const itens: ItemRascunho[] = []
    for (const i of c.itens) {
      if (itens.length >= restantes) break
      const nomeItem = cortar(i.nome, L.nome)
      if (!nomeItem) continue
      itens.push({
        nome: nomeItem,
        descricao: cortar(i.descricao, L.descricao),
        precoCentavos: preco(i.precoCentavos),
        tags: [...new Set(i.tags.filter((t) => TAGS.has(t)))].slice(0, L.tags),
        outrosNomes: [],
        unidade: cortar(i.unidade, L.unidade),
        incluir: true,
      })
    }
    restantes -= itens.length
    if (itens.length) categorias.push({ nome, itens })
  }
  return rascunhoSchema.parse({ categorias })
}

/** O nome do arquivo vai para o provedor: só caracteres seguros (sem texto que pareça instrução). */
export function nomeSeguro(filename: string, extensao: string): string {
  const base = filename.replace(/\.[^.]*$/, '').normalize('NFD').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60)
  return `${base || 'cardapio'}.${extensao}`
}

function anexo(arquivo: { mime: string; base64: string; filename: string }): ConteudoUsuario | null {
  if (arquivo.mime === 'application/pdf') return { type: 'pdf', filename: nomeSeguro(arquivo.filename, 'pdf'), base64: arquivo.base64 }
  if ((MIMES_IMAGEM_INGESTAO as readonly string[]).includes(arquivo.mime)) return { type: 'image', mime: arquivo.mime, base64: arquivo.base64 }
  return null
}

/**
 * Lê um cardápio (PDF ou imagem) e devolve um RASCUNHO para revisão humana (PRD I10: documento nunca vira dado
 * oficial sem confirmação). PDF pelo motor nativo do modelo; a política de dados (deny + zdr) é do cliente.
 */
export async function lerCardapioPorIa(
  llm: LlmClient,
  p: { models: string[]; arquivo: { mime: string; base64: string; filename: string } },
): Promise<JsonCallResult<RascunhoCardapio>> {
  const parte = anexo(p.arquivo)
  if (!parte) return { ok: false, error: 'tipo_nao_suportado', retryable: false, status: null, model: null, usage: null, latencyMs: 0 }
  return llm.completeJson({
    models: p.models,
    system: ingestaoSystemPrompt,
    user: 'O cardápio está no anexo. Extraia as categorias e os itens conforme as regras.',
    userParts: [parte],
    schemaName: 'rascunho_cardapio',
    jsonSchema: ingestaoJsonSchema,
    parse: parseLeituraCardapio,
    maxTokens: INGESTAO_MAX_TOKENS,
    timeoutMs: INGESTAO_TIMEOUT_MS,
  })
}
