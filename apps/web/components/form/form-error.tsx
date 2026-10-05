'use client'
import { AlertTriangle } from 'lucide-react'
import type { FieldValues, UseFormReturn } from 'react-hook-form'

export function FormError<T extends FieldValues, O extends FieldValues = T>({ form }: { form: UseFormReturn<T, unknown, O> }) {
  const message = form.formState.errors.root?.server?.message
  if (!message) return null
  return (
    <p role="alert" className="flex items-start gap-2 rounded-md border border-destructive bg-card p-3 text-sm font-medium text-destructive">
      <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      {message}
    </p>
  )
}
