import type * as React from 'react'
import { CLASSE_TOM, TOM_DA_VARIANTE, type VarianteEtiqueta } from '@/design/etiquetas'
import { cn } from '@/lib/utils'

export type { VarianteEtiqueta }

/** Etiqueta de status padronizada: mono, caixa-alta, cor do tom da variante (contraste em `design/etiquetas.test.ts`). */
export function EtiquetaStatus({ variante, className, ...props }: React.ComponentProps<'span'> & { variante: VarianteEtiqueta }) {
  return (
    <span
      data-slot="etiqueta-status"
      data-variante={variante}
      className={cn(
        'inline-flex w-fit shrink-0 items-center rounded-sm border px-1.5 py-px font-mono text-[11px] leading-4 font-semibold tracking-wide whitespace-nowrap uppercase',
        CLASSE_TOM[TOM_DA_VARIANTE[variante]],
        className,
      )}
      {...props}
    />
  )
}
