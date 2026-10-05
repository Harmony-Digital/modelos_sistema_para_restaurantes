'use client'
import { X } from 'lucide-react'
import { forwardRef, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase()

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string[]
  onChange: (next: string[]) => void
  max?: number
  /** Nome da lista de etiquetas para leitores de tela. */
  listLabel?: string
}

export const TagInput = forwardRef<HTMLInputElement, Props>(function TagInput(
  { value, onChange, max = 20, listLabel = 'Etiquetas', className, onBlur, onKeyDown, ...props },
  ref,
) {
  const [rascunho, setRascunho] = useState('')
  const [aviso, setAviso] = useState('')
  const container = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement | null>(null)
  const setRefs = (el: HTMLInputElement | null) => {
    input.current = el
    if (typeof ref === 'function') ref(el)
    else if (ref) ref.current = el
  }

  const adicionar = (partes: string[]) => {
    const next = [...value]
    const novas: string[] = []
    let limite = false
    for (const bruta of partes) {
      const tag = bruta.trim()
      if (!tag || next.some((v) => norm(v) === norm(tag))) continue
      if (next.length >= max) { limite = true; continue }
      next.push(tag)
      novas.push(tag)
    }
    if (novas.length) onChange(next)
    if (limite) setAviso(`Limite de ${max} etiquetas atingido`)
    else if (novas.length) setAviso(`${novas.join(', ')} adicionada`)
  }
  const remover = (tag: string) => {
    onChange(value.filter((v) => v !== tag))
    setAviso(`${tag} removida`)
    input.current?.focus()
  }

  return (
    <div
      ref={container}
      className={cn(
        'flex min-h-11 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-card px-2 py-1.5',
        'focus-within:ring-2 focus-within:ring-ring has-[[aria-invalid=true]]:border-destructive',
        className,
      )}
    >
      {value.length > 0 && (
        <ul aria-label={listLabel} className="flex flex-wrap items-center gap-1.5">
          {value.map((tag) => (
            <li key={tag} className="inline-flex items-center gap-1 rounded-sm bg-secondary py-1 pl-2 pr-1 text-sm text-secondary-foreground">
              {tag}
              <button
                type="button"
                aria-label={`Remover ${tag}`}
                onClick={() => remover(tag)}
                className="relative flex size-6 items-center justify-center rounded-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring after:absolute after:left-1/2 after:top-1/2 after:size-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']"
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        {...props}
        ref={setRefs}
        value={rascunho}
        onChange={(e) => {
          const partes = e.target.value.split(',')
          if (partes.length > 1) {
            adicionar(partes.slice(0, -1))
            setRascunho(partes[partes.length - 1] ?? '')
          } else setRascunho(e.target.value)
        }}
        onKeyDown={(e) => {
          onKeyDown?.(e)
          if (e.defaultPrevented) return
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            adicionar([rascunho])
            setRascunho('')
          }
          if (e.key === 'Backspace' && rascunho === '' && value.length > 0) {
            const ultima = value[value.length - 1] as string
            onChange(value.slice(0, -1))
            setAviso(`${ultima} removida`)
          }
        }}
        onBlur={(e) => {
          onBlur?.(e)
          if (container.current?.contains(e.relatedTarget as Node | null)) return
          adicionar([rascunho])
          setRascunho('')
        }}
        className="min-w-32 flex-1 bg-transparent px-1 py-1.5 text-base text-foreground placeholder:text-muted-foreground focus:outline-none"
      />
      <span role="status" aria-live="polite" className="sr-only">{aviso}</span>
    </div>
  )
})
