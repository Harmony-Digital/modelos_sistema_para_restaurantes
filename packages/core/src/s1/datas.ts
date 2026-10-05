import { normalizeText } from '../normalize.ts'
import type { Feriado } from './feriados.ts'
import { dataIso, dataValida, diaDaSemana, partesDaData, somarDias, type DataIso } from './tempo.ts'

export type ResultadoData = { ok: true; data: DataIso } | { ok: false }

const FALHA: ResultadoData = { ok: false }

// inclui abreviações comuns no WhatsApp ("dmg", "sab", "qua")
const DIAS_SEMANA: readonly [RegExp, number][] = [
  [/\b(domingo|dom|dmg)\b/, 0], [/\b(segunda|seg)\b/, 1], [/\b(terca|ter)\b/, 2], [/\b(quarta|qua|qrt)\b/, 3],
  [/\b(quinta|qui|qnt)\b/, 4], [/\b(sexta|sex)\b/, 5], [/\b(sabado|sab|sbd)\b/, 6],
]

const MESES: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
}

// Verificado ANTES dos dias da semana: "sexta-feira santa" não é "sexta".
const APELIDOS_FERIADO: readonly [RegExp, string][] = [
  [/\b(ano novo|confraternizacao)\b/, 'Confraternização Universal'],
  [/\btiradentes\b/, 'Tiradentes'],
  [/\b(dia do trabalho|dia do trabalhador|primeiro de maio)\b/, 'Dia do Trabalho'],
  [/\b(independencia|sete de setembro)\b/, 'Independência do Brasil'],
  [/\b(aparecida|padroeira|dia das criancas)\b/, 'Nossa Senhora Aparecida'],
  [/\bfinados\b/, 'Finados'],
  [/\bproclamacao\b/, 'Proclamação da República'],
  [/\b(consciencia negra|zumbi)\b/, 'Dia Nacional de Zumbi e da Consciência Negra'],
  [/\bnatal\b/, 'Natal'],
  [/\bcarnaval\b/, 'Carnaval'],
  [/\b(sexta feira santa|sexta santa|paixao de cristo)\b/, 'Sexta-feira Santa'],
  [/\bcorpus christi\b/, 'Corpus Christi'],
]

function proximoFeriado(feriados: readonly Feriado[], hoje: DataIso, nome?: string): ResultadoData {
  const f = feriados
    .filter((x) => x.data >= hoje && (!nome || x.nome === nome))
    .sort((a, b) => (a.data < b.data ? -1 : 1))[0]
  return f ? { ok: true, data: f.data } : FALHA
}

function comAno(dia: number, mes: number, ano: number | null, hoje: DataIso): ResultadoData {
  if (ano !== null) {
    const a = ano < 100 ? 2000 + ano : ano
    return dataValida(a, mes, dia) ? { ok: true, data: dataIso(a, mes, dia) } : FALHA
  }
  const { ano: atual } = partesDaData(hoje)
  for (const a of [atual, atual + 1]) {
    if (dataValida(a, mes, dia) && dataIso(a, mes, dia) >= hoje) return { ok: true, data: dataIso(a, mes, dia) }
  }
  return FALHA
}

function diaDoMes(dia: number, hoje: DataIso): ResultadoData {
  const h = partesDaData(hoje)
  for (let i = 0; i < 13; i++) {
    const absoluto = h.mes - 1 + i
    const ano = h.ano + Math.floor(absoluto / 12)
    const mes = (absoluto % 12) + 1
    if (dataValida(ano, mes, dia) && dataIso(ano, mes, dia) >= hoje) return { ok: true, data: dataIso(ano, mes, dia) }
  }
  return FALHA
}

/** Traduz a data citada pelo cliente; o que não entender devolve ok=false (nunca chuta). */
export function resolverData(texto: string | null, hoje: DataIso, feriados: readonly Feriado[]): ResultadoData {
  const bruto = (texto ?? '').toLowerCase()
  const t = normalizeText(bruto)
  if (t === '' || /\b(hoje|hj|agora)\b/.test(t)) return { ok: true, data: hoje }
  if (/\bdepois de amanha\b/.test(t)) return { ok: true, data: somarDias(hoje, 2) }
  if (/\bamanha\b/.test(t)) return { ok: true, data: somarDias(hoje, 1) }
  for (const [re, nome] of APELIDOS_FERIADO) if (re.test(t)) return proximoFeriado(feriados, hoje, nome)
  if (/\bferiados?\b/.test(t)) return proximoFeriado(feriados, hoje)

  // "/" e "-" somem na normalização: datas numéricas são lidas do texto bruto
  const num = /(\d{1,2})\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*(\d{4}|\d{2}))?/.exec(bruto)
  if (num) return comAno(Number(num[1]), Number(num[2]), num[3] ? Number(num[3]) : null, hoje)
  const extenso = /\b(\d{1,2}|primeiro)\s+de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/.exec(t)
  if (extenso) return comAno(extenso[1] === 'primeiro' ? 1 : Number(extenso[1]), MESES[extenso[2]!]!, null, hoje)

  for (const [re, dia] of DIAS_SEMANA) {
    if (re.test(t)) return { ok: true, data: somarDias(hoje, (dia - diaDaSemana(hoje) + 7) % 7) }
  }
  if (/\bfim de semana\b/.test(t)) return { ok: true, data: somarDias(hoje, (6 - diaDaSemana(hoje) + 7) % 7) }

  const soDia = /^(?:dia\s+)?(\d{1,2})$/.exec(t) ?? /\bdia\s+(\d{1,2})\b/.exec(t)
  if (soDia) {
    const d = Number(soDia[1])
    return d >= 1 && d <= 31 ? diaDoMes(d, hoje) : FALHA
  }
  return FALHA
}
