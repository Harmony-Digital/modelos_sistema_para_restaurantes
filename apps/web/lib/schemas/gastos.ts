import { z } from 'zod'

export const ESCOPOS_GASTO = ['ia', 'simulacao', 'whatsapp'] as const
export const PERIODOS_GASTO = ['dia', 'mes'] as const
export type EscopoGasto = (typeof ESCOPOS_GASTO)[number]
export type PeriodoGasto = (typeof PERIODOS_GASTO)[number]

export const NOME_ESCOPO: Record<EscopoGasto, string> = { ia: 'IA (clientes)', simulacao: 'Simulação', whatsapp: 'WhatsApp' }
export const NOME_PERIODO: Record<PeriodoGasto, string> = { dia: 'do dia', mes: 'do mês' }

const LIMITE_MAX_USD = 10_000

/** "2,50" ou "2.50" → "2.50" (string decimal, sem float no caminho para o banco). */
const decimal = (s: string) => s.trim().replace(',', '.')
const temDigitoNaoZero = (s: string) => /[1-9]/.test(s)

export const limiteSchema = z.object({
  escopo: z.enum(ESCOPOS_GASTO, { error: 'Escolha o tipo de gasto' }),
  periodo: z.enum(PERIODOS_GASTO, { error: 'Escolha o período' }),
  limiteUsd: z
    .string()
    .transform(decimal)
    .refine((v) => /^\d{1,6}(\.\d{1,6})?$/.test(v), 'Informe um valor em dólar, como 2,50 (até 6 casas)')
    .refine((v) => temDigitoNaoZero(v), 'O limite precisa ser maior que zero')
    .refine((v) => Number(v) <= LIMITE_MAX_USD, 'Use no máximo US$ 10.000'),
  alertaPct: z
    .string()
    .trim()
    .refine((v) => /^\d{1,3}$/.test(v) && Number(v) >= 1 && Number(v) <= 100, 'Use um número de 1 a 100')
    .transform(Number),
})
export type LimiteForm = z.input<typeof limiteSchema>

export const cotacaoSchema = z.object({
  cotacao: z
    .string()
    .transform(decimal)
    .refine((v) => /^\d{1,2}(\.\d{1,4})?$/.test(v), 'Informe a cotação com até 4 casas, como 5,50')
    .refine((v) => Number(v) >= 0.5 && Number(v) <= 50, 'Use uma cotação entre 0,50 e 50'),
})
export type CotacaoForm = z.input<typeof cotacaoSchema>
