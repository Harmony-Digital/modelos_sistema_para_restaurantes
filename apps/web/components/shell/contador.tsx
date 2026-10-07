import { cn } from '@/lib/utils'

/** Selo numérico de aguardando (o nome acessível do link já diz o número). */
export function ContadorAguardando({ valor, className }: { valor: number; className?: string }) {
  if (valor <= 0) return null
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-destructive px-1 font-mono text-[11px] font-semibold leading-none tabular-nums text-destructive-foreground',
        className,
      )}
    >
      {valor > 99 ? '99+' : valor}
    </span>
  )
}
