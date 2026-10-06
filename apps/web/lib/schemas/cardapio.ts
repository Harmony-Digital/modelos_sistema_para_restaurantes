import { z } from 'zod'
import { TAGS_CARDAPIO, type TagCardapio } from '@atd/core/s4'
import { reaisParaCentavos } from '@/lib/dinheiro'

/** Etiquetas do cardápio (chips) vêm do domínio. Os limites repetem os checks do banco (0026) e do rascunho de importação. */
export { TAGS_CARDAPIO, type TagCardapio }
export const ROTULO_TAG: Record<TagCardapio, string> = {
  vegano: 'Vegano',
  vegetariano: 'Vegetariano',
  sem_gluten: 'Sem glúten',
  sem_lactose: 'Sem lactose',
  infantil: 'Infantil',
  bebida: 'Bebida',
  sobremesa: 'Sobremesa',
}

const PRECO_MAX = 10_000_000
/** Forma das etiquetas lidas do CSV (normalizadas como as conhecidas). */
const ETIQUETA_PROPRIA = /^[a-z0-9_]{1,30}$/
const nome = z.string().trim().min(1, 'Informe o nome').max(80, 'Use no máximo 80 caracteres')
const posicao = z.string().trim().regex(/^\d{1,4}$/, 'Use um número inteiro, como 1').transform(Number)

const preco = (msg: string) =>
  z.string().refine((v) => (reaisParaCentavos(v) ?? 0) <= PRECO_MAX, msg).transform(reaisParaCentavos)
const MSG_PRECO = 'O preço máximo é R$ 100.000,00'

export const categoriaSchema = z.object({
  nome: nome,
  ordem: posicao,
  ativo: z.boolean(),
})
export type CategoriaForm = z.input<typeof categoriaSchema>

export const itemSchema = z.object({
  categoryId: z.uuid('Escolha uma categoria'),
  nome: nome,
  descricao: z.string().trim().max(300, 'Use no máximo 300 caracteres').transform((v) => (v === '' ? null : v)),
  /** "R$ 12,50" na tela; centavos (ou null = sob consulta) depois de validado */
  preco: preco(MSG_PRECO),
  /** as conhecidas (chips) e as próprias que vieram do CSV ("Do chef" ⇒ do_chef), preservadas ao editar o item */
  tags: z.array(z.union([z.enum(TAGS_CARDAPIO), z.string().regex(ETIQUETA_PROPRIA, 'Etiqueta inválida')])).max(10, 'Use no máximo 10 etiquetas'),
  outrosNomes: z.array(z.string().trim().min(1).max(80, 'Cada nome pode ter até 80 caracteres')).max(10, 'Use no máximo 10 nomes'),
  disponivel: z.boolean(),
  ordem: z.number().int().min(0).max(9999),
})
export type ItemForm = z.input<typeof itemSchema>

export const DISPONIBILIDADES = ['segue', 'sim', 'nao'] as const
export const excecaoSchema = z
  .object({
    itemId: z.uuid(),
    unitId: z.uuid('Escolha uma unidade'),
    disponivel: z.enum(DISPONIBILIDADES, 'Escolha uma opção'),
    preco: preco(MSG_PRECO),
  })
  .transform((v) => ({
    itemId: v.itemId,
    unitId: v.unitId,
    disponivel: v.disponivel === 'segue' ? null : v.disponivel === 'sim',
    precoOverrideCentavos: v.preco,
  }))
export type ExcecaoForm = z.input<typeof excecaoSchema>

export const arquivoMetaSchema = z.object({
  titulo: z.string().trim().min(1, 'Dê um título ao arquivo').max(80, 'Use no máximo 80 caracteres'),
  /** '' = vale para todas as unidades */
  unitId: z.union([z.literal(''), z.uuid('Escolha uma unidade da lista')]).transform((v) => (v === '' ? null : v)),
})
export type ArquivoMetaForm = z.input<typeof arquivoMetaSchema>

/** Opções da confirmação da importação: usar o PDF/foto importado como arquivo de envio (geral ou de uma unidade). */
export const opcoesImportacaoSchema = z.object({
  usarComoArquivoDeEnvio: z.boolean(),
  unitIdArquivo: z.uuid('Escolha uma unidade da lista').nullable(),
})
export type OpcoesImportacao = z.input<typeof opcoesImportacaoSchema>
