import { z } from 'zod'

const conversa = z.uuid('Simulação inválida.')
export const enviarSimuladorSchema = z.object({
  conversationId: conversa,
  texto: z.string().trim().min(1, 'Escreva uma mensagem.').max(1000, 'Mensagem muito longa (máximo de 1000 caracteres).'),
  interativoId: z.string().max(200).nullable(),
})
export const buscarSimuladorSchema = z.object({ conversationId: conversa, desdeId: z.number().int().min(0) })
export const relogioSimuladorSchema = z.object({
  conversationId: conversa,
  local: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Informe a data e a hora.').nullable(),
})
export const conversaSimuladorSchema = z.object({ conversationId: conversa })
