import { DIAS_SEMANA, diaDaSemana, type DataIso } from '@atd/core/s1'
import type { StatusPedido } from '@atd/db'
import { dataBr } from '@/lib/previsao'
import { STATUS_PEDIDO } from '@/lib/schemas/eventos'

export const ROTULO_STATUS: Record<StatusPedido, string> = {
  novo: 'Novo',
  em_contato: 'Em contato',
  confirmado: 'Confirmado',
  recusado: 'Recusado',
  cancelado: 'Cancelado',
}

/** Padrão da fila: o que ainda pede trabalho. */
export const STATUS_PADRAO: readonly StatusPedido[] = ['novo', 'em_contato']

// espelha as transições do banco (`atualizarPedido`); o servidor é quem decide, aqui só evita oferecer o impossível
const TRANSICOES: Record<StatusPedido, readonly StatusPedido[]> = {
  novo: ['em_contato', 'confirmado', 'recusado', 'cancelado'],
  em_contato: ['confirmado', 'recusado', 'cancelado'],
  confirmado: ['cancelado'],
  recusado: [],
  cancelado: [],
}

/** O status atual mais os que ele pode virar, na ordem do ciclo. */
export function statusPossiveis(atual: StatusPedido): StatusPedido[] {
  return STATUS_PEDIDO.filter((s) => s === atual || TRANSICOES[atual].includes(s))
}

/** `?status=novo,em_contato`: ignora valor desconhecido; ausente ou só lixo ⇒ padrão. */
export function statusDaUrl(param: string | undefined): StatusPedido[] {
  if (param === undefined) return [...STATUS_PADRAO]
  const pedidos = new Set(param.split(','))
  const ok = STATUS_PEDIDO.filter((s) => pedidos.has(s))
  return ok.length > 0 ? ok : [...STATUS_PADRAO]
}

export function hrefEventos(p: { status: readonly StatusPedido[]; unidade: string | null }): string {
  const padrao = p.status.length === STATUS_PADRAO.length && STATUS_PADRAO.every((s) => p.status.includes(s))
  let href = '/agenda?aba=eventos'
  if (!padrao) href += `&status=${STATUS_PEDIDO.filter((s) => p.status.includes(s)).join(',')}`
  if (p.unidade) href += `&unidade=${encodeURIComponent(p.unidade)}`
  return href
}

/** Liga/desliga um status do filtro; nunca deixa o filtro vazio (o último não sai). */
export function alternarStatus(atual: readonly StatusPedido[], s: StatusPedido): StatusPedido[] {
  if (!atual.includes(s)) return STATUS_PEDIDO.filter((x) => x === s || atual.includes(x))
  return atual.length === 1 ? [...atual] : atual.filter((x) => x !== s)
}

export function dataDoEvento(d: string): string {
  return `${dataBr(d as DataIso)} · ${DIAS_SEMANA[diaDaSemana(d as DataIso)]}`
}

/** "há 5 min", "há 1 hora", "há 3 horas", "há 2 dias". */
export function haQuanto(criado: Date, agora: Date): string {
  const min = Math.max(0, Math.floor((agora.getTime() - criado.getTime()) / 60_000))
  if (min < 1) return 'agora há pouco'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 48) return `há ${h} ${h === 1 ? 'hora' : 'horas'}`
  return `há ${Math.floor(h / 24)} dias`
}

export function linksTelefone(telefone: string): { tel: string; wa: string } {
  const digitos = telefone.replace(/\D/g, '')
  return { tel: `tel:+${digitos}`, wa: `https://wa.me/${digitos}` }
}
