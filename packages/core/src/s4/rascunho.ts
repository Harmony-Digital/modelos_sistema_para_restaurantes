import { z } from 'zod'

/** Limites do rascunho de cardápio (CSV, IA e revisão usam o mesmo schema). Iguais aos checks do banco. */
export const LIMITES_RASCUNHO = {
  categorias: 50,
  itens: 500,
  nome: 80,
  descricao: 300,
  precoMax: 10_000_000,
  tags: 10,
  tag: 30,
  outrosNomes: 10,
  unidade: 80,
} as const

const L = LIMITES_RASCUNHO
const nome = z.string().trim().min(1).max(L.nome)

export const itemRascunhoSchema = z.object({
  nome,
  descricao: z.string().trim().max(L.descricao).nullable(),
  /** centavos; null = "preço sob consulta" (ou ilegível no documento) */
  precoCentavos: z.number().int().min(0).max(L.precoMax).nullable(),
  tags: z.array(z.string().trim().min(1).max(L.tag)).max(L.tags),
  outrosNomes: z.array(nome).max(L.outrosNomes),
  /** nome da unidade quando o preço vale só para ela */
  unidade: z.string().trim().min(1).max(L.unidade).nullable(),
  incluir: z.boolean(),
})

export const categoriaRascunhoSchema = z.object({
  nome,
  itens: z.array(itemRascunhoSchema).max(L.itens),
})

export const rascunhoSchema = z
  .object({ categorias: z.array(categoriaRascunhoSchema).max(L.categorias) })
  .refine((r) => r.categorias.reduce((n, c) => n + c.itens.length, 0) <= L.itens, {
    message: `no máximo ${L.itens} itens`,
    path: ['categorias'],
  })

export type ItemRascunho = z.infer<typeof itemRascunhoSchema>
export type CategoriaRascunho = z.infer<typeof categoriaRascunhoSchema>
export type RascunhoCardapio = z.infer<typeof rascunhoSchema>
