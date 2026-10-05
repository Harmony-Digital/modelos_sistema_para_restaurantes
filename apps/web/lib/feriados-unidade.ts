import {
  agoraLocal, DIAS_SEMANA, diaDaSemana, feriadosNacionais, formatarTurnos, horarioDoDia, mapaFeriados, partesDaData, somarDias,
  type AgendaUnidade, type DataIso, type PoliticaFeriado,
} from '@atd/core/s1'

export type DiaEspecial = {
  data: DataIso
  dataBr: string
  rotulo: string
  feriado: string | null
  comportamento: string
  temExcecao: boolean
  motivo: string | null
}

const paraBr = (d: DataIso) => {
  const { ano, mes, dia } = partesDaData(d)
  return `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${ano}`
}

function diaEspecial(u: AgendaUnidade, data: DataIso, politica: PoliticaFeriado, feriados: ReadonlyMap<DataIso, string>): DiaEspecial {
  const h = horarioDoDia(u, data, politica, feriados)
  const dataBr = paraBr(data)
  return {
    data,
    dataBr,
    rotulo: `${DIAS_SEMANA[diaDaSemana(data)]}, ${dataBr}`,
    feriado: h.feriado,
    comportamento: h.turnos.length ? `Abre ${formatarTurnos(h.turnos)}` : 'Fechada',
    temExcecao: h.origem === 'excecao',
    motivo: u.excecoes[data]?.motivo ?? null,
  }
}

function mapaDoPeriodo(hoje: DataIso) {
  const ano = Number(hoje.slice(0, 4))
  const lista = [...feriadosNacionais(ano), ...feriadosNacionais(ano + 1)]
  return { lista, mapa: mapaFeriados(lista) }
}

export function feriadosComComportamento(u: AgendaUnidade, politica: PoliticaFeriado, timezone: string, agora: Date, dias = 365): DiaEspecial[] {
  const hoje = agoraLocal(agora, timezone).data
  const limite = somarDias(hoje, dias)
  const { lista, mapa } = mapaDoPeriodo(hoje)
  const vistos = new Set<DataIso>()
  return lista
    .filter((f) => f.data >= hoje && f.data <= limite && !vistos.has(f.data) && (vistos.add(f.data), true))
    .map((f) => diaEspecial(u, f.data, politica, mapa))
}

export function excecoesCadastradas(u: AgendaUnidade, timezone: string, agora: Date, politica: PoliticaFeriado = 'como_domingo'): DiaEspecial[] {
  const hoje = agoraLocal(agora, timezone).data
  const { mapa } = mapaDoPeriodo(hoje)
  return Object.keys(u.excecoes)
    .filter((d) => d >= hoje)
    .sort()
    .map((d) => diaEspecial(u, d as DataIso, politica, mapa))
}
