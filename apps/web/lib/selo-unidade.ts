import {
  agoraLocal, asHora, estadoAgora, feriadosNacionais, mapaFeriados, quandoAbre, temHorarioCadastrado,
  type AgendaUnidade, type PoliticaFeriado,
} from '@atd/core/s1'

export type Selo = { tom: 'aberta' | 'fechada' | 'alerta'; texto: string }

export function seloDaUnidade(u: AgendaUnidade & { ativo: boolean }, politica: PoliticaFeriado, timezone: string, agora: Date): Selo {
  if (!u.ativo) return { tom: 'alerta', texto: 'Desativada' }
  if (!temHorarioCadastrado(u)) return { tom: 'alerta', texto: 'Horário não cadastrado' }
  const local = agoraLocal(agora, timezone)
  const ano = Number(local.data.slice(0, 4))
  const e = estadoAgora(u, politica, mapaFeriados([...feriadosNacionais(ano), ...feriadosNacionais(ano + 1)]), local)
  if (e.aberta) return { tom: 'aberta', texto: `Aberta agora · fecha ${asHora(e.fecha.hora)}` }
  if (e.abre) return { tom: 'fechada', texto: `Fechada · abre ${quandoAbre(e.abre.data, local.data)} ${asHora(e.abre.hora)}` }
  return { tom: 'fechada', texto: 'Fechada' }
}
