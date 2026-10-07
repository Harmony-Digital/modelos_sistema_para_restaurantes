import { z } from 'zod'
import { somarDias, type DataIso } from '@atd/core/s1'
import { capturarTelefone, MAX_PESSOAS, MIN_PESSOAS } from '@atd/core/s2'

export const DIAS_A_FRENTE = 30

const MSG_DATA_FORA = `Escolha um dia de hoje até ${DIAS_A_FRENTE} dias à frente.`
const MSG_PESSOAS = `Informe de ${MIN_PESSOAS} a ${MAX_PESSOAS} pessoas.`
const MSG_CONTATO = 'Informe o telefone com DDD, como (61) 99999-8888.'

/** Situações da reserva que o painel muda (Confirmada, Cancelada, Não veio). */
export const STATUS_RESERVA = ['confirmada', 'cancelada', 'nao_veio'] as const
export const statusReservaSchema = z.enum(STATUS_RESERVA)

export function dataIsoValida(v: string): v is DataIso {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

/**
 * Reserva criada pelo painel (quando o cliente reserva por telefone ou no balcão): nome e horário obrigatórios; contato
 * opcional, normalizado para E.164 com a mesma regra da captura do worker (a action cifra; vazio ⇒ null). `hoje`
 * (YYYY-MM-DD no fuso do restaurante) vem de fora: o mesmo schema vale no navegador e no servidor (que recebe a saída
 * já transformada do navegador, por isso pessoas e contato aceitam também o valor final).
 */
export const reservaSchema = (hoje: DataIso) => {
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
      .min(1, 'Informe o horário, como 20:00.')
      .refine((v) => v === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(v), 'Use o formato 24h HH:mm, como 20:00.'),
    nome: z.string().trim().min(1, 'Informe o nome da reserva.').max(60, 'Use no máximo 60 caracteres.'),
    contato: z
      .union([z.string(), z.null()])
      .transform((v, ctx) => {
        const t = (v ?? '').trim()
        if (t === '') return null
        const e164 = capturarTelefone(t)
        if (!e164) {
          ctx.addIssue({ code: 'custom', message: MSG_CONTATO })
          return z.NEVER
        }
        return e164
      }),
  })
}
export type ReservaForm = z.input<ReturnType<typeof reservaSchema>>
