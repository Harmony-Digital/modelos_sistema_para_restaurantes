// Domínio puro de gastos: níveis de alerta e formatação de dinheiro.
// Valores monetários chegam como string decimal (numeric do Postgres) e são
// manipulados em inteiros (BigInt) para evitar float.

const ESCALA = 6 // casas decimais internas de USD (micros)
const RE_DECIMAL = /^\d+(\.\d+)?$/

/** Converte string decimal não negativa para inteiro escalado (arredonda meio para cima). */
function paraEscalado(valor: string, casas: number): bigint {
  const v = valor.trim()
  if (!RE_DECIMAL.test(v)) throw new RangeError(`valor decimal inválido: ${valor}`)
  const [inteira, frac = ''] = v.split('.')
  const base = BigInt(inteira + frac.slice(0, casas).padEnd(casas, '0'))
  const resto = frac.slice(casas)
  return resto.length > 0 && resto.charCodeAt(0) >= 53 ? base + 1n : base
}

function agrupar(inteiro: bigint): string {
  return inteiro.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/** Nível de alerta: 100 se gasto >= limite; 80 se >= alertaPct% do limite; senão 0. */
export function nivelAlerta(
  gastoMaisReservado: number,
  limite: number,
  alertaPct: number,
): 0 | 80 | 100 {
  if (!(limite > 0)) throw new RangeError('limite deve ser maior que zero')
  if (!(alertaPct >= 1 && alertaPct <= 100)) {
    throw new RangeError('alertaPct deve estar entre 1 e 100')
  }
  if (gastoMaisReservado >= limite) return 100
  if (gastoMaisReservado * 100 >= limite * alertaPct) return 80
  return 0
}

/** Percentual do limite já consumido (pode passar de 100). */
export function percentual(gasto: string, limite: string): number {
  const g = paraEscalado(gasto, ESCALA)
  const l = paraEscalado(limite, ESCALA)
  if (l === 0n) throw new RangeError('limite deve ser maior que zero')
  return Number((g * 1_000_000n) / l) / 10_000
}

/** USD (string decimal) × cotação → "R$ 1.234,56", arredondado ao centavo. */
export function emReais(usd: string, cotacao: string): string {
  const u = paraEscalado(usd, ESCALA) // 1e-6
  const c = paraEscalado(cotacao, 4) // 1e-4
  const produto = u * c // 1e-10
  const centavos = (produto + 50_000_000n) / 100_000_000n
  const reais = centavos / 100n
  const cents = (centavos % 100n).toString().padStart(2, '0')
  return `R$ ${agrupar(reais)},${cents}`
}

/** "US$ 0,0123" (4 casas abaixo de 1) ou "US$ 12,35" (2 casas a partir de 1). */
export function formatarUsd(usd: string): string {
  const micros = paraEscalado(usd, ESCALA)
  // 4 casas abaixo de 1 — mas se o arredondamento a 4 casas já chega a 1 (0,99996), vale a regra de 2 casas
  const casas = micros + 50n < 1_000_000n ? 4 : 2
  const divisor = 10n ** BigInt(ESCALA - casas)
  const escalado = (micros + divisor / 2n) / divisor
  const pot = 10n ** BigInt(casas)
  const inteiro = escalado / pot
  const frac = (escalado % pot).toString().padStart(casas, '0')
  return `US$ ${agrupar(inteiro)},${frac}`
}
