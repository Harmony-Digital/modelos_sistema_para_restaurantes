import { z } from 'zod'
import { estadoAgora, validarTurnos, type AgendaUnidade, type Turno } from '../s1/horarios.ts'
import { dasHora } from '../s1/modelos.ts'
import { agoraLocal, dataIso, diaDaSemana, diasEntre, type DataIso } from '../s1/tempo.ts'

/** Dias na ordem de `diaDaSemana` (0 = domingo). */
export const DIAS_HORARIO_HUMANO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const
export type DiaHorarioHumano = (typeof DIAS_HORARIO_HUMANO)[number]

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use o formato HH:MM (ex.: 09:00).')
const turnoSchema = z.object({ inicio: hhmm, fim: hhmm })
const turnosSchema = z.array(turnoSchema).max(4, 'Use no máximo 4 turnos por dia.').superRefine((ts, ctx) => {
  // mesmas regras dos turnos do S1 (inclui madrugada: fim antes do início)
  const erro = validarTurnos(ts.map((t) => ({ abre: t.inicio, fecha: t.fim })))
  if (erro) ctx.addIssue({ code: 'custom', message: erro })
})

/** `restaurants.horario_atendimento_humano`: turnos da equipe por dia, no fuso do restaurante. `{ dias: {} }` = sem horário. */
export const horarioHumanoSchema = z.object({ dias: z.partialRecord(z.enum(DIAS_HORARIO_HUMANO), turnosSchema) })
export type HorarioHumano = z.infer<typeof horarioHumanoSchema>

/** Próxima abertura: `dia` é a data local do restaurante como meia-noite UTC (`AAAA-MM-DDT00:00:00Z`). */
export type ProximoHorarioHumano = { dia: Date; inicio: string }
export type EstadoHorarioHumano = { aberto: true } | { aberto: false; proximo: ProximoHorarioHumano | null }

const SEM_FERIADOS: ReadonlyMap<DataIso, string> = new Map()
const paraData = (d: DataIso) => new Date(`${d}T00:00:00Z`)
const deData = (d: Date): DataIso => dataIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())

function agendaDe(h: HorarioHumano): AgendaUnidade {
  const semanal: Turno[][] = DIAS_HORARIO_HUMANO.map((d) => (h.dias[d] ?? []).map((t) => ({ abre: t.inicio, fecha: t.fim })))
  return { semanal, excecoes: {} }
}

/**
 * A equipe está atendendo agora? Senão, quando volta. Mesmo esquema de turnos do S1 (madrugada inclusa);
 * feriado não afeta. `proximo: null` ⇒ sem horário cadastrado (não prometer horário).
 */
export function proximoHorarioHumano(h: HorarioHumano, agora: Date, tz: string): EstadoHorarioHumano {
  const r = estadoAgora(agendaDe(h), 'normal', SEM_FERIADOS, agoraLocal(agora, tz))
  if (r.aberta) return { aberto: true }
  return { aberto: false, proximo: r.abre ? { dia: paraData(r.abre.data), inicio: r.abre.hora } : null }
}

const NOMES_CURTOS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'] as const

/** "hoje a partir das 14h", "amanhã a partir das 9h", "na segunda a partir das 9h", "no sábado a partir das 10h30". */
export function textoProximoHorario(p: ProximoHorarioHumano, agora: Date, tz: string): string {
  const dia = deData(p.dia)
  const delta = diasEntre(agoraLocal(agora, tz).data, dia)
  const sem = diaDaSemana(dia)
  const quando = delta === 0 ? 'hoje' : delta === 1 ? 'amanhã' : `${sem === 0 || sem === 6 ? 'no' : 'na'} ${NOMES_CURTOS[sem]}`
  return `${quando} a partir ${dasHora(p.inicio)}`
}
