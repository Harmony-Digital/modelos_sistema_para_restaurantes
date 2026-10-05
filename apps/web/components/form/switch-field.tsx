'use client'
import { Switch } from '@/components/ui/switch'

export function SwitchField(props: { id: string; label: string; hint?: string; checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean }) {
  const hintId = props.hint ? `${props.id}-ajuda` : undefined
  return (
    <div className="flex min-h-11 items-center justify-between gap-4">
      <div>
        <label htmlFor={props.id} className="text-sm font-medium">{props.label}</label>
        {props.hint && <p id={hintId} className="text-sm text-muted-foreground">{props.hint}</p>}
      </div>
      <Switch id={props.id} checked={props.checked} onCheckedChange={props.onCheckedChange} disabled={props.disabled} aria-describedby={hintId} />
    </div>
  )
}
