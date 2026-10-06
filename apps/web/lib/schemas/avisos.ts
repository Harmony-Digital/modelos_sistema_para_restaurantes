import { z } from 'zod'
import { somarDias, type DataIso } from '@atd/core/s1'
import { MAX_PESSOAS, MIN_PESSOAS } from '@atd/core/s2'

export const DIAS_A_FRENTE = 30

const MSG_DATA_FORA = `Escolha um dia de hoje até ${DIAS_A_FRENTE} dias à frente.`
const MSG_PESSOAS = `Informe de ${MIN_PESSOAS} a ${MAX_PESSOAS} pessoas.`

export function dataIsoValida(v: string): v is DataIso {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

/** `hoje` (YYYY-MM-DD no fuso do restaurante) vem de fora: o mesmo schema vale no navegador e no servidor. */
export const avisoSchema = (hoje: DataIso) => {
  const limite = somarDias(hoje, DIAS_A_FRENTE)
  return z.object({
    unitId: z.uuid('Escolha uma unidade.'),
    data: z
      .string()
      .trim()
      .refine(dataIsoValida, 'Informe uma data válida.')
      .refine((v) => !dataIsoValida(v) || (v >= hoje && v <= limite), MSG_DATA_FORA),
    pessoas: z
      .union([z.string(), z.number()])
      .transform((v, ctx) => {
        const n = typeof v === 'number' ? v : /^\d{1,3}$/.test(v.trim()) ? Number(v.trim()) : NaN
        if (!Number.isInteger(n) || n < MIN_PESSOAS || n > MAX_PESSOAS) {
          ctx.addIssue({ code: 'custom', message: MSG_PESSOAS })
          return z.NEVER
        }
        return n
      }),
    horario: z
      .string()
      .trim()
      .refine((v) => v === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(v), 'Use o formato 24h HH:mm, como 20:00.'),
    nome: z.string().trim().max(60, 'Use no máximo 60 caracteres.'),
  })
}
export type AvisoForm = z.input<ReturnType<typeof avisoSchema>>
