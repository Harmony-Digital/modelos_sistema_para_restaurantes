import { z } from 'zod'

export const STATUS_PEDIDO = ['novo', 'em_contato', 'confirmado', 'recusado', 'cancelado'] as const
export const MAX_NOTAS = 2000

export const pedidoSchema = z.object({
  status: z.enum(STATUS_PEDIDO, 'Escolha um status da lista'),
  /** '' = ninguém */
  responsavelId: z.union([z.literal(''), z.uuid('Escolha alguém da lista')]),
  notasInternas: z.string().trim().max(MAX_NOTAS, `Use no máximo ${MAX_NOTAS} caracteres`),
})
export type PedidoForm = z.input<typeof pedidoSchema>
