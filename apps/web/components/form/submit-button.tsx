import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function SubmitButton(props: { pending?: boolean; pendingText?: string; children: React.ReactNode; className?: string }) {
  return (
    <Button type="submit" disabled={props.pending} aria-busy={props.pending || undefined} className={props.className}>
      {props.pending && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
      {props.pending ? (props.pendingText ?? 'Salvando…') : props.children}
    </Button>
  )
}
