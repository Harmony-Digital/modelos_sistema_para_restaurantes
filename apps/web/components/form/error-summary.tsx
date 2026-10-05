'use client'
import { AlertTriangle } from 'lucide-react'
import type { FieldValues, UseFormReturn } from 'react-hook-form'

export type SummaryItem = { id: string; label: string; message: string }

export function useErrorSummary<T extends FieldValues, O extends FieldValues = T>(form: UseFormReturn<T, unknown, O>, labels: Record<string, string>): SummaryItem[] {
  const { errors, submitCount } = form.formState
  if (submitCount === 0) return []
  return Object.entries(labels)
    .map(([id, label]) => ({ id, label, message: (errors as Record<string, { message?: string } | undefined>)[id]?.message ?? '' }))
    .filter((e) => e.message)
}

export function ErrorSummary({ errors }: { errors: SummaryItem[] }) {
  if (errors.length === 0) return null
  const titulo = errors.length === 1 ? 'Corrija 1 campo' : `Corrija ${errors.length} campos`
  return (
    <section aria-label={titulo} className="rounded-md border border-destructive bg-card p-4">
      <h2 className="mb-2 flex items-center gap-2 font-sans text-sm font-semibold text-destructive">
        <AlertTriangle aria-hidden="true" className="size-4" /> {titulo}
      </h2>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {errors.map((e) => (
          <li key={e.id}>
            <a
              href={`#${e.id}`}
              className="text-link underline-offset-4 hover:underline"
              onClick={(ev) => { ev.preventDefault(); document.getElementById(e.id)?.focus() }}
            >
              {e.label}: {e.message}
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
