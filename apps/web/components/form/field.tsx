import { AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ControlProps = {
  id: string
  'aria-invalid': boolean
  'aria-describedby': string | undefined
  'aria-required': boolean | undefined
}

export function Field(props: {
  id: string
  label: string
  hint?: string
  error?: string | undefined
  required?: boolean
  className?: string
  children: (control: ControlProps) => React.ReactNode
}) {
  const hintId = props.hint ? `${props.id}-ajuda` : undefined
  const errorId = props.error ? `${props.id}-erro` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <div className={cn('group flex flex-col gap-1.5', props.className)} data-invalid={props.error ? '' : undefined}>
      <label
        htmlFor={props.id}
        className="text-sm font-medium text-foreground transition-colors duration-150 group-focus-within:text-link group-data-[invalid]:text-destructive"
      >
        {props.label}
        {props.required && <span aria-hidden="true" className="ml-0.5 text-destructive">*</span>}
      </label>
      {props.children({
        id: props.id,
        'aria-invalid': Boolean(props.error),
        'aria-describedby': describedBy,
        'aria-required': props.required || undefined,
      })}
      {props.hint && (
        <p id={hintId} className="text-sm text-muted-foreground">{props.hint}</p>
      )}
      {props.error && (
        <p id={errorId} role="alert" className="flex items-start gap-1.5 text-sm font-medium text-destructive">
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {props.error}
        </p>
      )}
    </div>
  )
}
