import {
  agoraLocal, DIAS_SEMANA, diaDaSemana, feriadosNacionais, formatarTurnos, mapaFeriados, partesDaData, somarDias,
  type AgendaUnidade, type DataIso, type PoliticaFeriado,
} from '@atd/core/s1'
import { validarAvisoNaAgenda } from '@atd/core/s2'
import { DIAS_A_FRENTE } from '@/lib/schemas/avisos'

export const FUSO_PADRAO = 'America/Sao_Paulo'

export const hojeLocal = (agora: Date, timezone: string = FUSO_PADRAO): DataIso => agoraLocal(agora, timezone).data
export const limiteDaPrevisao = (hoje: DataIso): DataIso => somarDias(hoje, DIAS_A_FRENTE)

export function dataBr(d: DataIso): string {
  const { ano, mes, dia } = partesDaData(d)
  return `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${ano}`
}

export function rotuloDoDia(d: DataIso, hoje: DataIso): string {
  const base = `${DIAS_SEMANA[diaDaSemana(d)]}, ${dataBr(d)}`
  return d === hoje ? `Hoje · ${base}` : base
}

/** Mesma regra do resolver da IA (agenda da unidade, feriado, turnos e horário de hoje que já passou); erros por campo ou null. */
export function validarAvisoNaUnidade(
  unidade: AgendaUnidade,
  data: DataIso,
  horario: string,
  politica: PoliticaFeriado,
  agora: { data: DataIso; minuto: number },
): Record<string, string> | null {
  const ano = Number(agora.data.slice(0, 4))
  const feriados = mapaFeriados([...feriadosNacionais(ano), ...feriadosNacionais(ano + 1)])
  const v = validarAvisoNaAgenda(unidade, data, horario === '' ? null : horario, politica, feriados, agora)
  if (v.ok) return null
  if (v.motivo === 'fechada') return { data: 'A unidade não abre nesse dia.' }
  if (v.motivo === 'horario_passado') return { horario: 'Esse horário de hoje já passou.' }
  return { horario: `Nesse dia a unidade funciona ${formatarTurnos(v.turnos ?? [])}.` }
}
