import { z } from 'zod'

export const PAPEIS_CONVITE = [
  { valor: 'gerente', rotulo: 'Gerente' },
  { valor: 'atendente', rotulo: 'Atendente' },
] as const

export const conviteSchema = z
  .object({
    email: z.string().trim().toLowerCase().min(1, 'Informe o e-mail').max(254, 'E-mail muito longo').pipe(z.email('Informe um e-mail válido')),
    nome: z.string().trim().min(1, 'Informe o nome').max(80, 'Use no máximo 80 caracteres'),
    papel: z.enum(['gerente', 'atendente'], 'Escolha o papel'),
    todas: z.boolean(),
    unidades: z.array(z.uuid()),
  })
  .refine((v) => v.todas || v.unidades.length > 0, { path: ['unidades'], message: 'Escolha ao menos uma unidade' })
export type ConviteForm = z.input<typeof conviteSchema>
