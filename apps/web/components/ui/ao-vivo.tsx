import { cn } from '@/lib/utils'

/** Indicador "● AO VIVO" onde a tela atualiza em tempo real. Conteúdo fixo: o leitor de tela anuncia uma vez. */
export function AoVivo({ className, rotulo = 'Ao vivo' }: { className?: string; rotulo?: string }) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn('inline-flex items-center gap-1.5 rounded-sm bg-success/8 px-1.5 py-px font-mono text-[11px] leading-4 font-semibold tracking-wide text-success uppercase dark:bg-success/12', className)}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current motion-safe:animate-pulse" />
      {rotulo}
    </span>
  )
}
