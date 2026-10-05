import { z } from 'zod'

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Informe o e-mail')
  .pipe(z.email('Digite um e-mail completo, como nome@empresa.com.br'))

export const senhaLogin = z.string().min(1, 'Informe a senha')

export const senhaNova = z
  .string()
  .min(12, 'Use pelo menos 12 caracteres')
  .max(72, 'Use no máximo 72 caracteres')
  .refine((v) => /[A-Za-zÀ-ÿ]/.test(v) && /\d/.test(v), 'Misture letras e números (ex.: Restaurante2026)')

export const hora = z
  .string()
  .trim()
  .min(1, 'Informe a hora')
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use o formato 24h HH:mm, como 11:30')

export const dataBr = z
  .string()
  .trim()
  .min(1, 'Informe a data')
  .regex(/^\d{2}\/\d{2}\/\d{4}$/, 'Use dd/mm/aaaa, como 12/10/2026')
  .transform((v, ctx) => {
    const [d, m, y] = v.split('/').map(Number) as [number, number, number]
    const dt = new Date(Date.UTC(y, m - 1, d))
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
      ctx.addIssue({ code: 'custom', message: 'Data inexistente. Use dd/mm/aaaa, como 12/10/2026' })
      return z.NEVER
    }
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  })

export const telefoneBr = z
  .string()
  .refine((v) => !/\p{L}/u.test(v), 'Use só números, como (61) 99999-8888')
  .transform((v) => {
    const digits = v.replace(/\D/g, '')
    return (digits.length === 12 || digits.length === 13) && digits.startsWith('55') ? digits.slice(2) : digits
  })
  .refine((v) => v.length === 10 || v.length === 11, 'Informe DDD + número, como (61) 99999-8888')

export function texto(min: number, max: number, rotulo: string) {
  return z
    .string()
    .trim()
    .min(1, `Informe ${rotulo}`)
    .min(min, `${rotulo} precisa ter pelo menos ${min} caracteres`)
    .max(max, `${rotulo} pode ter no máximo ${max} caracteres`)
}
