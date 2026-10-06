import { z } from 'zod'

export const MAX_RESPOSTA = 4096

/**
 * Resposta do atendente ao cliente (mesmo limite da DAL e do WhatsApp). O `.max` do Zod 4 conta code points
 * (emoji = 1), a mesma régua de `responderConversa` (`[...t].length`); coberto em conversas.test.ts.
 */
export const respostaSchema = z.object({
  texto: z.string().trim()
    .min(1, 'Escreva a resposta.')
    .max(MAX_RESPOSTA, `A resposta passa de ${MAX_RESPOSTA} caracteres.`),
})
export type RespostaForm = z.input<typeof respostaSchema>

export const assumirSchema = z.object({ forcar: z.boolean().default(false) })
export type AssumirForm = z.input<typeof assumirSchema>
