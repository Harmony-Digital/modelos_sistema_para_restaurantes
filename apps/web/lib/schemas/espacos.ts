import { z } from 'zod'

const MSG_CAPACIDADE = 'Informe um número de 1 a 1000.'
const capacidade = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const n = typeof v === 'number' ? v : /^\d{1,4}$/.test(v.trim()) ? Number(v.trim()) : NaN
  if (!Number.isInteger(n) || n < 1 || n > 1000) {
    ctx.addIssue({ code: 'custom', message: MSG_CAPACIDADE })
    return z.NEVER
  }
  return n
})
const opcional = (max: number) => z.string().trim().max(max, `Use no máximo ${max} caracteres`)

export const espacoSchema = z
  .object({
    nome: z.string().trim().min(1, 'Informe o nome do espaço, como "Salão"').max(60, 'Use no máximo 60 caracteres'),
    capacidadeMin: capacidade,
    capacidadeMax: capacidade,
    descricao: opcional(300),
    condicoes: opcional(500),
    ativo: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.capacidadeMin > v.capacidadeMax) {
      ctx.addIssue({ code: 'custom', path: ['capacidadeMin'], message: 'A capacidade mínima não pode ser maior que a máxima.' })
    }
  })
export type EspacoForm = z.input<typeof espacoSchema>
