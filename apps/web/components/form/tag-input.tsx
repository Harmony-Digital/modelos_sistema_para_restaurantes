'use client'
import { X } from 'lucide-react'
import { forwardRef, useState } from 'react'
import { cn } from '@/lib/utils'

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase()

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string[]
  onChange: (next: string[]) => void
  max?: number
}

export const TagInput = forwardRef<HTMLInputElement, Props>(function TagInput({ value, onChange, max = 20, className, ...props }, ref) {
  const [rascunho, setRascunho] = useState('')
  const adicionar = (bruto: string) => {
    const tag = bruto.trim()
    if (!tag || value.length >= max || value.some((v) => norm(v) === norm(tag))) return setRascunho('')
    onChange([...value, tag])
    setRascunho('')
  }
  return (
    <div
      className={cn(
        'flex min-h-11 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-card px-2 py-1.5',
        'focus-within:ring-2 focus-within:ring-ring has-[[aria-invalid=true]]:border-destructive',
        className,
      )}
    >
      {/* O campo vem primeiro no DOM (é ele o controle do rótulo) e as etiquetas aparecem antes dele só visualmente. */}
      <input
        ref={ref}
        value={rascunho}
        onChange={(e) => {
          const v = e.target.value
          if (v.endsWith(',')) adicionar(v.slice(0, -1))
          else setRascunho(v)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); adicionar(rascunho) }
          if (e.key === 'Backspace' && rascunho === '' && value.length > 0) onChange(value.slice(0, -1))
        }}
        onBlur={() => adicionar(rascunho)}
        className="order-last min-w-32 flex-1 bg-transparent px-1 py-1.5 text-base text-foreground placeholder:text-muted-foreground focus:outline-none"
        {...props}
      />
      {value.map((tag) => (
        <button
          key={tag}
          type="button"
          aria-label={`Remover ${tag}`}
          onClick={() => onChange(value.filter((v) => v !== tag))}
          className="inline-flex min-h-8 items-center gap-1 rounded-sm bg-secondary py-1 pl-2 pr-1.5 text-sm text-secondary-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
        >
          {tag}
          <X aria-hidden="true" className="size-3.5" />
        </button>
      ))}
    </div>
  )
})
