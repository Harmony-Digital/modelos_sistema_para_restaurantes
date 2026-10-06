import type { StatusPedido } from '@atd/db'
import { Badge } from '@/components/ui/badge'
import { ROTULO_STATUS } from '@/lib/eventos'

const COR_STATUS: Record<StatusPedido, string> = {
  novo: 'border-warning text-warning',
  em_contato: 'border-info text-info',
  confirmado: 'border-success text-success',
  recusado: 'border-border text-muted-foreground',
  cancelado: 'border-border text-muted-foreground',
}

export function SeloStatus({ status }: { status: StatusPedido }) {
  return <Badge variant="outline" className={COR_STATUS[status]}>{ROTULO_STATUS[status]}</Badge>
}
