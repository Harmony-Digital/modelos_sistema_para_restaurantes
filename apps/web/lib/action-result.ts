import type { z } from 'zod'

export type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; fieldErrors?: Record<string, string>; formError?: string }

export function fieldErrorsFromZod(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of err.issues) {
    const key = issue.path.join('.')
    if (key && !(key in out)) out[key] = issue.message
  }
  return out
}
