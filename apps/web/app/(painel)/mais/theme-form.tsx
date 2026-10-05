'use client'
import { Moon, Sun } from 'lucide-react'
import { useRef } from 'react'
import type { Tema } from '@/lib/theme'
import { cn } from '@/lib/utils'

const OPCOES: { valor: Tema; label: string; hint: string; icon: typeof Moon }[] = [
  { valor: 'escuro', label: 'Escuro', hint: 'Padrão — confortável à noite', icon: Moon },
  { valor: 'claro', label: 'Claro', hint: 'Melhor sob luz forte', icon: Sun },
]

export function ThemeForm(props: { atual: Tema; action: (fd: FormData) => void | Promise<void> }) {
  const form = useRef<HTMLFormElement>(null)
  return (
    <form ref={form} action={props.action}>
      <fieldset className="grid grid-cols-2 gap-3">
        <legend className="mb-2 text-sm font-medium text-foreground">Aparência</legend>
        {OPCOES.map(({ valor, label, hint, icon: Icon }) => (
          <label
            key={valor}
            className={cn(
              'flex min-h-20 cursor-pointer flex-col gap-1 rounded-md border bg-card p-3 transition-colors',
              'has-[:checked]:border-primary has-[:checked]:ring-2 has-[:checked]:ring-ring has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
              'border-input',
            )}
          >
            <input
              type="radio"
              name="tema"
              value={valor}
              defaultChecked={props.atual === valor}
              onChange={() => form.current?.requestSubmit()}
              className="sr-only"
            />
            <span className="flex items-center gap-2 font-semibold text-foreground"><Icon aria-hidden="true" className="size-4" />{label}</span>
            <span className="text-xs text-muted-foreground">{hint}</span>
          </label>
        ))}
      </fieldset>
    </form>
  )
}
