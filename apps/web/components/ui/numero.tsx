import type * as React from 'react'
import { cn } from '@/lib/utils'

const TAMANHO = { herdado: '', sm: 'text-sm', md: 'text-base', lg: 'text-2xl leading-tight', xl: 'text-3xl leading-tight' } as const

/** Número, horário ou valor em mono com algarismos tabulares (colunas alinhadas). */
export function Numero({ tamanho = 'herdado', className, ...props }: React.ComponentProps<'span'> & { tamanho?: keyof typeof TAMANHO }) {
  return <span data-slot="numero" className={cn('font-mono font-medium tabular-nums', TAMANHO[tamanho], className)} {...props} />
}
