import { normalizeText } from '../normalize.ts'

const MAX_TEXTO = 40

// texto livre sai sempre numa forma canônica: nunca repete o que o cliente/LLM escreveu
const VAGOS: readonly [RegExp, string][] = [
  [/\bfim (de|da) tarde\b/, 'no fim da tarde'],
  [/\bmais tarde\b/, 'mais tarde'],
  [/\bhappy hour\b/, 'no happy hour'],
  [/\bnoite\b/, 'à noite'],
  [/\btarde\b/, 'à tarde'],
  [/\bmanha\b/, 'de manhã'],
  [/\balmoco\b/, 'no almoço'],
  [/\bjanta(r)?\b/, 'no jantar'],
]

const HORA_MARCADA = /(?<!\d)(\d{1,2})\s*(?:(?:h|hs|hrs?|horas?)(?![a-zà-ú])|:)\s*(\d{2})?(?!\d)/
const HORA_PERIODO = /(?<!\d)(\d{1,2})(?!\d)(?=\s+da\s+(?:noite|tarde|manhã|manha|madrugada)\b)/
const HORA_APOS_AS = /(?:^|\s)(?:às|as|das|aos)\s+(\d{1,2})(?!\d)/
const HORA_SOLTA = /(?<!\d)(\d{1,2})(?!\d)/

const hhmm = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`

/** "20h" ⇒ 20:00; "às 19:30" ⇒ 19:30; "à noite" ⇒ livre; o que não entende ⇒ ambos null. */
export function normalizarHorario(texto: string | null): { hhmm: string | null; livre: string | null } {
  const nada = { hhmm: null, livre: null }
  const bruto = (texto ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
  if (!bruto || bruto.length > MAX_TEXTO) return nada
  const t = normalizeText(bruto)
  if (/\bmeia noite\b/.test(t)) return { hhmm: '00:00', livre: null }
  if (/\bmeio dia\b/.test(t)) return { hhmm: '12:00', livre: null }

  // prefere o número marcado como hora ("2 pessoas às 20h" ⇒ 20h, não 2h); o número solto é o último recurso
  const num = HORA_MARCADA.exec(bruto) ?? HORA_PERIODO.exec(bruto) ?? HORA_APOS_AS.exec(bruto) ?? HORA_SOLTA.exec(bruto)
  if (num) {
    let h = Number(num[1])
    const m = num[2] ? Number(num[2]) : 0
    if (h > 23 || m > 59) return nada
    if (/\bda (noite|tarde)\b/.test(t)) {
      if (h >= 1 && h < 12) h += 12
      else if (h === 12 && /\bda noite\b/.test(t)) h = 0
    }
    return { hhmm: hhmm(h, m), livre: null }
  }
  for (const [re, livre] of VAGOS) if (re.test(t)) return { hhmm: null, livre }
  return nada
}
