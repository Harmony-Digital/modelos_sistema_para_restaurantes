import { z } from 'zod'

export const restauranteSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome do restaurante').max(80, 'Use no máximo 80 caracteres'),
  politicaFeriado: z.enum(['normal', 'fechado', 'como_domingo'], { error: 'Escolha como funciona nos feriados' }),
  politicaUrl: z.string().trim().refine((v) => v === '' || /^https:\/\/\S+$/.test(v), 'Use um link completo que comece com https://'),
})
export type RestauranteForm = z.input<typeof restauranteSchema>
