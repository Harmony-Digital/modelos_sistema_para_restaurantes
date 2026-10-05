import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

export function SubmitButton(props: { pending?: boolean; pendingText?: string; children: React.ReactNode; className?: string }) {
  return (
    <Button
      type='submit'
      aria-disabled={props.pending || undefined}
      aria-busy={props.pending || undefined}
      onClick={(e) => { if (props.pending) e.preventDefault() }}
      className={cn(props.pending && 'cursor-wait opacity-50', props.className)}
    >
      {props.pending && <Loader2 aria-hidden='true' className='size-4 animate-spin' />}
      {props.pending ? (props.pendingText ?? 'Salvando…') : props.children}
    </Button>
  )
}
