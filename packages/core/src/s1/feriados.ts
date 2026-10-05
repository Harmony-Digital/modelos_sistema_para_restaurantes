import { dataIso, somarDias, type DataIso } from './tempo.ts'

export type Feriado = { data: DataIso; nome: string }

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano). */
export function pascoa(ano: number): DataIso {
  const a = ano % 19
  const b = Math.floor(ano / 100)
  const c = ano % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const n = h + l - 7 * m + 114
  return dataIso(ano, Math.floor(n / 31), (n % 31) + 1)
}

const FIXOS: readonly [mes: number, dia: number, nome: string, desde?: number][] = [
  [1, 1, 'Confraternização Universal'],
  [4, 21, 'Tiradentes'],
  [5, 1, 'Dia do Trabalho'],
  [9, 7, 'Independência do Brasil'],
  [10, 12, 'Nossa Senhora Aparecida'],
  [11, 2, 'Finados'],
  [11, 15, 'Proclamação da República'],
  [11, 20, 'Dia Nacional de Zumbi e da Consciência Negra', 2024],
  [12, 25, 'Natal'],
]

/** Feriados nacionais do ano (Carnaval e Corpus Christi incluídos: o comércio costuma tratá-los como feriado). */
export function feriadosNacionais(ano: number): Feriado[] {
  const p = pascoa(ano)
  const fixos = FIXOS.filter(([, , , desde]) => !desde || ano >= desde).map(([mes, dia, nome]) => ({ data: dataIso(ano, mes, dia), nome }))
  const moveis: Feriado[] = [
    { data: somarDias(p, -48), nome: 'Carnaval' },
    { data: somarDias(p, -47), nome: 'Carnaval' },
    { data: somarDias(p, -2), nome: 'Sexta-feira Santa' },
    { data: somarDias(p, 60), nome: 'Corpus Christi' },
  ]
  return [...fixos, ...moveis].sort((x, y) => (x.data < y.data ? -1 : x.data > y.data ? 1 : 0))
}

export function mapaFeriados(lista: readonly Feriado[]): Map<DataIso, string> {
  return new Map(lista.map((f) => [f.data, f.nome]))
}
