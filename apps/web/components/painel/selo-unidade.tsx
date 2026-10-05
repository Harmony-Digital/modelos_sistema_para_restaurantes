import { AlertTriangle, CircleDot, Moon } from 'lucide-react'
import type { Selo } from '@/lib/selo-unidade'
import { cn } from '@/lib/utils'

const ICONE = { aberta: CircleDot, fechada: Moon, alerta: AlertTriangle } as const

export function SeloUnidade({ selo }: { selo: Selo }) {
  const Icone = ICONE[selo.tom]
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 text-sm font-medium',
        selo.tom === 'aberta' && 'text-success',
        selo.tom === 'fechada' && 'text-muted-foreground',
        selo.tom === 'alerta' && 'text-warning',
      )}
    >
      <Icone aria-hidden="true" className="size-4" />
      {selo.texto}
    </span>
  )
}
