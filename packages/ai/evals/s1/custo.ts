import { TRIAGE_BUDGET_ESTIMATE_USD } from '../../src/triage.ts'

/** Custo (US$) a cobrar de uma chamada: o real, ou a estimativa quando o provedor não informa (teto nunca fica cego). */
export function custoDaChamada(usage: { costUsd: string | null } | null | undefined): number {
  const real = usage?.costUsd == null ? Number.NaN : Number(usage.costUsd)
  return Number.isFinite(real) && real >= 0 ? real : Number(TRIAGE_BUDGET_ESTIMATE_USD)
}
