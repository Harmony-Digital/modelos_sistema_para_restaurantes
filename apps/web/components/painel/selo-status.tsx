import type { StatusPedido } from '@atd/db'
import { EtiquetaStatus } from '@/components/ui/etiqueta-status'
import { ROTULO_STATUS } from '@/lib/eventos'

export function SeloStatus({ status }: { status: StatusPedido }) {
  return <EtiquetaStatus variante={status}>{ROTULO_STATUS[status]}</EtiquetaStatus>
}
