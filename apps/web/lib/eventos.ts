import { DIAS_SEMANA, diaDaSemana, type DataIso } from '@atd/core/s1'
import { TRANSICOES_PEDIDO_EVENTO } from '@atd/core/s3'
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

/** O status atual mais os que ele pode virar, na ordem do ciclo. */
export function statusPossiveis(atual: StatusPedido): StatusPedido[] {
  return STATUS_PEDIDO.filter((s) => s === atual || TRANSICOES_PEDIDO_EVENTO[atual].includes(s))
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

export type MembroTela = { id: string; nome: string; todas: boolean; unidades: string[] }

/** Quem pode ser responsável por um pedido: acessa todas as unidades ou tem a do pedido (mesma regra da DAL). */
export function membrosDaUnidade<T extends { todas: boolean; unidades: string[] }>(membros: T[], unitId: string): T[] {
  return membros.filter((m) => m.todas || m.unidades.includes(unitId))
}
