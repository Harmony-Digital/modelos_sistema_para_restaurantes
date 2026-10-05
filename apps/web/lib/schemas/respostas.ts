import { z } from 'zod'
import { validarModelo, type ChaveModelo } from '@atd/core/s1'

export const fatoSchema = z.object({
  tema: z.string().trim().min(1, 'Informe o assunto, como "Estacionamento"').max(120, 'Use no máximo 120 caracteres'),
  exemplos: z.array(z.string().trim().min(1).max(120, 'Cada exemplo pode ter até 120 caracteres')).max(10, 'Use no máximo 10 exemplos'),
  texto: z.string().trim().min(1, 'Escreva a resposta que a IA deve enviar').max(1000, 'Use no máximo 1000 caracteres'),
  /** '' = vale para todas as unidades */
  unitId: z.union([z.literal(''), z.uuid('Escolha uma unidade da lista')]),
  ativo: z.boolean(),
})
export type FatoForm = z.input<typeof fatoSchema>

export const modeloSchema = (chave: ChaveModelo) =>
  z.object({ texto: z.string() }).superRefine((v, ctx) => {
    const e = validarModelo(chave, v.texto)
    if (e) ctx.addIssue({ code: 'custom', path: ['texto'], message: e })
  })
export type ModeloForm = { texto: string }
