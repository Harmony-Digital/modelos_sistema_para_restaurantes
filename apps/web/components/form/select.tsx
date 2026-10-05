import { ChevronDown } from 'lucide-react'
import { forwardRef } from 'react'
import { cn } from '@/lib/utils'
import { controlClass } from './text-input'

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <div className="relative">
        <select ref={ref} className={cn(controlClass, 'appearance-none pr-10', className)} {...props}>{children}</select>
        <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      </div>
    )
  },
)
