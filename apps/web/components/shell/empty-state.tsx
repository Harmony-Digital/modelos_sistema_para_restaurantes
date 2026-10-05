import type { LucideIcon } from 'lucide-react'

export function EmptyState(props: { icon: LucideIcon; title: string; description: string; action?: React.ReactNode }) {
  const Icon = props.icon
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-secondary text-primary">
        <Icon aria-hidden="true" className="size-6" />
      </span>
      <h2 className="text-lg font-semibold text-foreground">{props.title}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">{props.description}</p>
      {props.action}
    </div>
  )
}
