'use client'
import type { FieldValues, Path, UseFormReturn } from 'react-hook-form'
import type { ActionResult } from '@/lib/action-result'

export function applyServerErrors<T extends FieldValues, O extends FieldValues = T>(form: UseFormReturn<T, unknown, O>, result: ActionResult<unknown>) {
  if (result.ok) return
  const entries = Object.entries(result.fieldErrors ?? {})
  entries.forEach(([name, message], i) => {
    form.setError(name as Path<T>, { type: 'server', message }, { shouldFocus: i === 0 })
  })
  if (result.formError) form.setError('root.server', { type: 'server', message: result.formError })
}
