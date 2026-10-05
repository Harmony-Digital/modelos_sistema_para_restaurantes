import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export function StatCard(props: { label: string; value: string; hint?: string; tone?: 'neutro' | 'ok' | 'alerta' }) {
  const tone = props.tone ?? 'neutro'
  return (
    <div role="group" aria-label={`${props.label}: ${props.value}`} className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4">
      <span className="text-sm text-muted-foreground">{props.label}</span>
      <span data-tone={tone} className={cn('flex items-center gap-2 font-display text-3xl font-semibold tracking-tight',
        tone === 'ok' && 'text-success', tone === 'alerta' && 'text-destructive', tone === 'neutro' && 'text-foreground')}>
        {tone === 'ok' && <CheckCircle2 aria-hidden="true" className="size-6" />}
        {tone === 'alerta' && <AlertTriangle aria-hidden="true" className="size-6" />}
        {props.value}
      </span>
      {props.hint && <span className="text-sm text-muted-foreground">{props.hint}</span>}
    </div>
  )
}
