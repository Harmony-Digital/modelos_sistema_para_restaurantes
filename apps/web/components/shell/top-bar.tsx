import { cn } from '@/lib/utils'
import { AcoesBarra, FaixaDaBarra } from './acoes-barra'

/**
 * `semFaixa`: barras que só aparecem < lg (colunas da lista + detalhe) não repetem a faixa de alertas, que em ≥ lg
 * fica abaixo da barra do layout.
 */
export function TopBar(props: { title: string; subtitle?: string; action?: React.ReactNode; className?: string; semFaixa?: boolean }) {
  return (
    <>
      <header className={cn('sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur', props.className)}>
        <div className="mx-auto flex min-h-16 max-w-xl items-center justify-between gap-3 px-4 pt-[env(safe-area-inset-top)] lg:min-h-14 lg:max-w-none lg:px-8">
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-xl font-semibold tracking-tight text-foreground lg:text-lg">{props.title}</h1>
            {props.subtitle && <p className="truncate text-sm text-muted-foreground">{props.subtitle}</p>}
          </div>
          {props.action}
          <AcoesBarra />
        </div>
      </header>
      {!props.semFaixa && <FaixaDaBarra />}
    </>
  )
}
