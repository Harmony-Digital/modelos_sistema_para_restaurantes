export function TopBar(props: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex min-h-16 max-w-xl items-center justify-between gap-3 px-4 pt-[env(safe-area-inset-top)]">
        <div className="min-w-0">
          <h1 className="truncate font-display text-xl font-semibold tracking-tight text-foreground">{props.title}</h1>
          {props.subtitle && <p className="truncate text-sm text-muted-foreground">{props.subtitle}</p>}
        </div>
        {props.action}
      </div>
    </header>
  )
}
