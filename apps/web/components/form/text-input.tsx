import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

export const controlClass =
  'h-11 w-full rounded-md border border-input bg-card px-3 text-base text-foreground placeholder:text-muted-foreground ' +
  'transition-[box-shadow,border-color] duration-150 ease-out ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:shadow-lg ' +
  'aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-destructive ' +
  'disabled:cursor-not-allowed disabled:opacity-50'

export const TextInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ className, ...props }, ref) {
    return <input ref={ref} className={cn(controlClass, className)} {...props} />
  },
)
