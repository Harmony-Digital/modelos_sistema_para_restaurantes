import { forwardRef } from 'react'
import { cn } from '@/lib/utils'
import { controlClass } from './text-input'

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, rows = 4, ...props }, ref) {
    return <textarea ref={ref} rows={rows} className={cn(controlClass, 'h-auto min-h-24 py-2.5', className)} {...props} />
  },
)
