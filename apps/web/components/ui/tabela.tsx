import type * as React from 'react'
import { cn } from '@/lib/utils'

/** Tabela densa: rolagem horizontal própria (não corta entre 1024 e 1280 px), linhas finas. */
export function Tabela({ className, ...props }: React.ComponentProps<'table'>) {
  return (
    <div data-slot="tabela-rolagem" className="w-full min-w-0 overflow-x-auto">
      <table className={cn('w-full border-collapse text-sm', className)} {...props} />
    </div>
  )
}

export function TabelaCabecalho(props: React.ComponentProps<'thead'>) {
  return <thead {...props} />
}

export function TabelaCorpo(props: React.ComponentProps<'tbody'>) {
  return <tbody {...props} />
}

/** `selecionada` marca a linha aberta ao lado (aria-current + barra laranja à esquerda). */
export function TabelaLinha({ selecionada, className, ...props }: React.ComponentProps<'tr'> & { selecionada?: boolean | undefined }) {
  return (
    <tr
      aria-current={selecionada ? 'true' : undefined}
      className={cn(
        'border-b border-border last:border-b-0',
        selecionada && 'bg-accent/60 [&>td:first-child]:shadow-[inset_3px_0_0_var(--primary)]',
        className,
      )}
      {...props}
    />
  )
}

export function TabelaCelulaCabecalho({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      scope="col"
      className={cn('border-b border-border px-3 py-2 text-left font-mono text-[11px] font-medium tracking-wide whitespace-nowrap text-muted-foreground uppercase', className)}
      {...props}
    />
  )
}

export function TabelaCelula({ className, ...props }: React.ComponentProps<'td'>) {
  return <td className={cn('px-3 py-2 align-middle', className)} {...props} />
}
