import type { PrevisaoUnidade } from '@atd/db'
import {
  agoraLocal, DIAS_SEMANA, diaDaSemana, feriadosNacionais, formatarTurnos, mapaFeriados, partesDaData, somarDias,
  type AgendaUnidade, type DataIso, type PoliticaFeriado,
} from '@atd/core/s1'
import { validarAvisoNaAgenda } from '@atd/core/s2'
import { DIAS_A_FRENTE, dataIsoValida } from '@/lib/schemas/avisos'

export const FUSO_PADRAO = 'America/Sao_Paulo'

export const hojeLocal = (agora: Date, timezone: string = FUSO_PADRAO): DataIso => agoraLocal(agora, timezone).data
export const limiteDaPrevisao = (hoje: DataIso): DataIso => somarDias(hoje, DIAS_A_FRENTE)

/** Dia pedido na URL: inválido volta para hoje; fora de [hoje, hoje+30] vai para o limite mais próximo. */
export function dataDaUrl(param: string | undefined, hoje: DataIso): DataIso {
  if (!param || !dataIsoValida(param)) return hoje
  const limite = limiteDaPrevisao(hoje)
  return param < hoje ? hoje : param > limite ? limite : param
}

export function hrefPrevisao(p: { data: DataIso; hoje: DataIso; unidade?: string | undefined; cancelados?: boolean | undefined }): string {
  const q = new URLSearchParams()
  if (p.data !== p.hoje) q.set('data', p.data)
  if (p.unidade) q.set('unidade', p.unidade)
  if (p.cancelados) q.set('cancelados', '1')
  const s = q.toString()
  return s ? `/previsao?${s}` : '/previsao'
}

export function dataBr(d: DataIso): string {
  const { ano, mes, dia } = partesDaData(d)
  return `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${ano}`
}

export function rotuloDoDia(d: DataIso, hoje: DataIso): string {
  const base = `${DIAS_SEMANA[diaDaSemana(d)]}, ${dataBr(d)}`
  return d === hoje ? `Hoje · ${base}` : base
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/** "N pessoas · M avisos": só avisos ativos entram na conta. */
export function resumoUnidade(p: PrevisaoUnidade): { pessoas: string; avisos: string } {
  const ativos = p.avisos.filter((a) => a.status === 'ativo')
  return { pessoas: plural(p.totalPessoas, 'pessoa', 'pessoas'), avisos: plural(ativos.length, 'aviso', 'avisos') }
}

/** Mesma regra do resolver da IA (agenda da unidade, feriado e turnos); devolve erros por campo ou null. */
export function validarAvisoNaUnidade(
  unidade: AgendaUnidade,
  data: DataIso,
  horario: string,
  politica: PoliticaFeriado,
  hoje: DataIso,
): Record<string, string> | null {
  const ano = Number(hoje.slice(0, 4))
  const feriados = mapaFeriados([...feriadosNacionais(ano), ...feriadosNacionais(ano + 1)])
  const v = validarAvisoNaAgenda(unidade, data, horario === '' ? null : horario, politica, feriados)
  if (v.ok) return null
  return v.motivo === 'fechada'
    ? { data: 'A unidade não abre nesse dia.' }
    : { horario: `Nesse dia a unidade funciona ${formatarTurnos(v.turnos ?? [])}.` }
}
