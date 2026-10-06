import { percentual } from '@atd/core/gastos'
import type { EscopoGasto, PeriodoGasto } from './schemas/gastos'

const CURTO: Record<EscopoGasto, string> = { ia: 'IA', simulacao: 'Simulação', whatsapp: 'WhatsApp' }
const PERIODO: Record<PeriodoGasto, string> = { dia: 'do dia', mes: 'do mês' }

/** % do limite já usado, arredondado para baixo (82,9% é 82%). Limite zero = esgotado; valor inválido = 0. */
export function pctDoLimite(uso: string, limite: string): number {
  try {
    return Math.floor(percentual(uso, limite))
  } catch (e) {
    return e instanceof RangeError && /limite/.test(e.message) ? 100 : 0
  }
}

type AlertaTela = {
  escopo: EscopoGasto; periodo: PeriodoGasto; nivel: 80 | 100; usoUsd: string; limiteUsd: string; limiteAlteradoDepois: boolean
}

/**
 * A IA desse escopo está parada (modo econômico): alerta de 100%, a menos que o dono tenha mudado o limite depois e o uso
 * esteja abaixo dele. Sem mudança no limite, o 100% vale mesmo com o uso um pouco abaixo (a reserva seguinte não coube).
 */
export function emModoEconomico(a: AlertaTela): boolean {
  return a.nivel === 100 && !(a.limiteAlteradoDepois && pctDoLimite(a.usoUsd, a.limiteUsd) < 100)
}

/** "IA: 82% do limite do dia". Em modo econômico nunca mostra menos de 100%; com o limite aumentado, o % atual. */
export function textoAlerta(a: AlertaTela): string {
  const pct = pctDoLimite(a.usoUsd, a.limiteUsd)
  return `${CURTO[a.escopo]}: ${emModoEconomico(a) ? Math.max(pct, 100) : pct}% do limite ${PERIODO[a.periodo]}`
}

/** numeric do banco ("2.000000") → texto do campo ("2,00"): pelo menos 2 casas, sem zeros sobrando. */
export function usdParaCampo(v: string): string {
  const [int = '0', frac = ''] = v.split('.')
  const f = frac.replace(/0+$/, '').padEnd(2, '0')
  return `${int},${f}`
}

export type OpcaoMes = { valor: string; rotulo: string }

/** Os últimos `n` meses ('AAAA-MM'), do atual (no fuso do restaurante) para trás. */
export function ultimosMeses(agora: Date, timezone: string, n = 12): OpcaoMes[] {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit' }).formatToParts(agora)
  const ano = Number(partes.find((p) => p.type === 'year')?.value)
  const mes = Number(partes.find((p) => p.type === 'month')?.value)
  const nome = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(ano, mes - 1 - i, 1))
    const valor = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    return { valor, rotulo: nome.format(d) }
  })
}

/** numeric (até 6 casas) → micro-dólares inteiros. */
function micros(v: string): bigint {
  const [int = '0', frac = ''] = v.split('.')
  return BigInt(int || '0') * 1_000_000n + BigInt(frac.padEnd(6, '0').slice(0, 6))
}

/** Custo médio por conversa (US$, 6 casas) ou null sem conversa. Sem float. */
export function mediaPorConversa(totalUsd: string, conversas: number): string | null {
  if (!Number.isInteger(conversas) || conversas <= 0) return null
  const s = (micros(totalUsd) / BigInt(conversas)).toString().padStart(7, '0')
  return `${s.slice(0, -6)}.${s.slice(-6)}`
}

/** Mês da URL só se for um dos oferecidos; senão, o atual. */
export function mesDaBusca(q: string | string[] | undefined, meses: OpcaoMes[]): string {
  return typeof q === 'string' && meses.some((m) => m.valor === q) ? q : meses[0]!.valor
}
