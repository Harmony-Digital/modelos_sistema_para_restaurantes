import { diaDaSemana, somarDias, type DataIso } from './tempo.ts'

export type Turno = { abre: string; fecha: string }
export type PoliticaFeriado = 'normal' | 'fechado' | 'como_domingo'
export type ExcecaoDia = { fechado: boolean; turnos: Turno[]; motivo: string | null }
export type AgendaUnidade = { semanal: Turno[][]; excecoes: Record<DataIso, ExcecaoDia> }
export type HorarioDia = { turnos: Turno[]; origem: 'excecao' | 'feriado' | 'semanal'; feriado: string | null }
export type EstadoAgora =
  | { aberta: true; fecha: { data: DataIso; hora: string } }
  | { aberta: false; abre: { data: DataIso; hora: string } | null }

const HORA_RE = /^([01]\d|2[0-3]):([0-5]\d)$/
const DIA_MIN = 24 * 60

export function minutosDe(h: string): number {
  const m = HORA_RE.exec(h)
  if (!m) throw new Error(`Hora inválida: ${h}`)
  return Number(m[1]) * 60 + Number(m[2])
}

export const cruzaMeiaNoite = (t: Turno) => minutosDe(t.fecha) < minutosDe(t.abre)

const ordenar = (ts: readonly Turno[]) => [...ts].sort((a, b) => minutosDe(a.abre) - minutosDe(b.abre))

/** Precedência: exceção da data → feriado + política → regra semanal. */
export function horarioDoDia(
  agenda: AgendaUnidade,
  data: DataIso,
  politica: PoliticaFeriado,
  feriados: ReadonlyMap<DataIso, string>,
): HorarioDia {
  const feriado = feriados.get(data) ?? null
  const excecao = agenda.excecoes[data]
  if (excecao) return { turnos: excecao.fechado ? [] : ordenar(excecao.turnos), origem: 'excecao', feriado }
  if (feriado && politica !== 'normal') {
    return { turnos: politica === 'fechado' ? [] : ordenar(agenda.semanal[0] ?? []), origem: 'feriado', feriado }
  }
  return { turnos: ordenar(agenda.semanal[diaDaSemana(data)] ?? []), origem: 'semanal', feriado }
}

export function temHorarioCadastrado(agenda: AgendaUnidade): boolean {
  return agenda.semanal.some((d) => d.length > 0)
}

export function estadoAgora(
  agenda: AgendaUnidade,
  politica: PoliticaFeriado,
  feriados: ReadonlyMap<DataIso, string>,
  agora: { data: DataIso; minuto: number },
): EstadoAgora {
  const dia = (d: DataIso) => horarioDoDia(agenda, d, politica, feriados).turnos
  // turno de ontem que atravessou a meia-noite
  for (const t of dia(somarDias(agora.data, -1))) {
    if (cruzaMeiaNoite(t) && agora.minuto < minutosDe(t.fecha)) return { aberta: true, fecha: { data: agora.data, hora: t.fecha } }
  }
  const hoje = dia(agora.data)
  for (const t of hoje) {
    const abre = minutosDe(t.abre)
    const fecha = minutosDe(t.fecha)
    if (cruzaMeiaNoite(t) ? agora.minuto >= abre : agora.minuto >= abre && agora.minuto < fecha) {
      return { aberta: true, fecha: { data: cruzaMeiaNoite(t) ? somarDias(agora.data, 1) : agora.data, hora: t.fecha } }
    }
  }
  const maisTarde = hoje.find((t) => minutosDe(t.abre) > agora.minuto)
  if (maisTarde) return { aberta: false, abre: { data: agora.data, hora: maisTarde.abre } }
  for (let i = 1; i <= 14; i++) {
    const d = somarDias(agora.data, i)
    const primeiro = dia(d)[0]
    if (primeiro) return { aberta: false, abre: { data: d, hora: primeiro.abre } }
  }
  return { aberta: false, abre: null }
}

/** Regras compartilhadas com o formulário do painel (02-C). */
export function validarTurnos(turnos: readonly Turno[]): string | null {
  const intervalos: [number, number][] = []
  for (const [i, t] of turnos.entries()) {
    if (!HORA_RE.test(t.abre) || !HORA_RE.test(t.fecha)) return `Turno ${i + 1}: use o formato HH:MM (ex.: 11:30).`
    const abre = minutosDe(t.abre)
    const fecha = minutosDe(t.fecha)
    if (abre === fecha) return `Turno ${i + 1}: a abertura e o fechamento não podem ser iguais.`
    intervalos.push([abre, fecha < abre ? fecha + DIA_MIN : fecha])
  }
  intervalos.sort((a, b) => a[0] - b[0])
  for (let i = 1; i < intervalos.length; i++) {
    if (intervalos[i]![0] < intervalos[i - 1]![1]) return 'Os turnos se sobrepõem. Ajuste os horários para não haver conflito.'
  }
  return null
}
