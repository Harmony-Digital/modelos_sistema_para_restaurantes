/** Data de calendário 'AAAA-MM-DD', sem fuso. */
export type DataIso = string

const DATA_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function partesDaData(d: DataIso): { ano: number; mes: number; dia: number } {
  const m = DATA_RE.exec(d)
  if (!m) throw new Error(`Data inválida: ${d}`)
  return { ano: Number(m[1]), mes: Number(m[2]), dia: Number(m[3]) }
}

export function dataIso(ano: number, mes: number, dia: number): DataIso {
  return `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

export function dataValida(ano: number, mes: number, dia: number): boolean {
  const t = new Date(Date.UTC(ano, mes - 1, dia))
  return t.getUTCFullYear() === ano && t.getUTCMonth() === mes - 1 && t.getUTCDate() === dia
}

export function somarDias(d: DataIso, n: number): DataIso {
  const { ano, mes, dia } = partesDaData(d)
  const t = new Date(Date.UTC(ano, mes - 1, dia + n))
  return dataIso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
}

/** 0 = domingo … 6 = sábado */
export function diaDaSemana(d: DataIso): number {
  const { ano, mes, dia } = partesDaData(d)
  return new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay()
}

export function diasEntre(de: DataIso, ate: DataIso): number {
  const a = partesDaData(de)
  const b = partesDaData(ate)
  return Math.round((Date.UTC(b.ano, b.mes - 1, b.dia) - Date.UTC(a.ano, a.mes - 1, a.dia)) / 86_400_000)
}

/** Data e minuto do dia (0–1439) no fuso do restaurante. */
export function agoraLocal(agora: Date, timeZone: string): { data: DataIso; minuto: number } {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(agora)
  const g = (type: Intl.DateTimeFormatPartTypes) => p.find((x) => x.type === type)!.value
  return { data: `${g('year')}-${g('month')}-${g('day')}`, minuto: Number(g('hour')) * 60 + Number(g('minute')) }
}
