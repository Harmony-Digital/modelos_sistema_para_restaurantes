'use client'
import { get, type FieldValues, type Path, type UseFormReturn } from 'react-hook-form'
import type { ActionResult } from '@/lib/action-result'

export function applyServerErrors<T extends FieldValues, O extends FieldValues = T>(form: UseFormReturn<T, unknown, O>, result: ActionResult<unknown>) {
  if (result.ok) return
  const registered = (name: string) => Boolean(get(form.control._fields, name)?._f)
  const unknown: string[] = []
  let focused = false
  for (const [name, message] of Object.entries(result.fieldErrors ?? {})) {
    if (!registered(name)) {
      unknown.push(message)
      continue
    }
    form.setError(name as Path<T>, { type: 'server', message })
    if (!focused) {
      form.setFocus(name as Path<T>)
      focused = true
    }
  }
  const formMessage = [result.formError, ...unknown].filter(Boolean).join(' ')
  if (formMessage) form.setError('root.server', { type: 'server', message: formMessage })
}
