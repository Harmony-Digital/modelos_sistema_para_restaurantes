'use client'
import { Eye, EyeOff } from 'lucide-react'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { controlClass } from './text-input'

export const PasswordInput = forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>>(
  function PasswordInput({ className, ...props }, ref) {
    const [visivel, setVisivel] = useState(false)
    const inner = useRef<HTMLInputElement>(null)
    useImperativeHandle(ref, () => inner.current!, [])

    useEffect(() => {
      const form = inner.current?.form
      if (!form) return
      const ocultar = () => setVisivel(false)
      form.addEventListener('submit', ocultar)
      return () => form.removeEventListener('submit', ocultar)
    }, [])

    return (
      <div className="relative">
        <input ref={inner} type={visivel ? 'text' : 'password'} className={cn(controlClass, 'pr-12', className)} {...props} />
        <button
          type="button"
          onClick={() => setVisivel((v) => !v)}
          aria-pressed={visivel}
          aria-label={visivel ? 'Ocultar senha' : 'Mostrar senha'}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          {visivel ? <EyeOff aria-hidden="true" className="size-5" /> : <Eye aria-hidden="true" className="size-5" />}
        </button>
      </div>
    )
  },
)
