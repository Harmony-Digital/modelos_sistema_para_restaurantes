import { z } from 'zod'
import { senhaNova } from '@/lib/validation'

export const definirSenhaSchema = z
  .object({ senha: senhaNova, confirmacao: z.string().min(1, 'Repita a senha') })
  .refine((v) => v.senha === v.confirmacao, { path: ['confirmacao'], message: 'As senhas não conferem. Digite a mesma senha nos dois campos.' })
