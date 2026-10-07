import type { StatusPedido, StatusReserva } from '@atd/db'
import { EtiquetaStatus, type VarianteEtiqueta } from '@/components/ui/etiqueta-status'
import { ROTULO_STATUS_RESERVA } from '@/lib/agenda'
import { ROTULO_STATUS } from '@/lib/eventos'

export function SeloStatus({ status }: { status: StatusPedido }) {
  return <EtiquetaStatus variante={status}>{ROTULO_STATUS[status]}</EtiquetaStatus>
}

const VARIANTE_RESERVA: Record<StatusReserva, VarianteEtiqueta> = { confirmada: 'confirmado', cancelada: 'cancelado', nao_veio: 'nao_veio' }

/** Situação da reserva (Confirmada, Cancelada, Não veio). Sucesso só sobre cartão ou tint leve, nunca sobre muted. */
export function SeloStatusReserva({ status }: { status: StatusReserva }) {
  return <EtiquetaStatus variante={VARIANTE_RESERVA[status]}>{ROTULO_STATUS_RESERVA[status]}</EtiquetaStatus>
}
