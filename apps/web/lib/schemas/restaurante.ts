import { z } from 'zod'

export const restauranteSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome do restaurante').max(80, 'Use no máximo 80 caracteres'),
  politicaFeriado: z.enum(['normal', 'fechado', 'como_domingo'], { error: 'Escolha como funciona nos feriados' }),
  politicaUrl: z.string().trim().refine((v) => v === '' || /^https:\/\/\S+$/.test(v), 'Use um link completo que comece com https://'),
})
export type RestauranteForm = z.input<typeof restauranteSchema>

export const modoDemonstracaoSchema = z.object({ ligado: z.boolean() })
export type ModoDemonstracaoForm = z.input<typeof modoDemonstracaoSchema>

/** Mesmo limite do banco (`restaurants_regras_reserva_ck`). */
export const MAX_REGRAS_RESERVA = 600
export const regrasReservaSchema = z.object({
  texto: z.string().trim().min(1, 'Escreva as regras da reserva.').max(MAX_REGRAS_RESERVA, `Use no máximo ${MAX_REGRAS_RESERVA} caracteres.`),
})
export type RegrasReservaForm = z.input<typeof regrasReservaSchema>
