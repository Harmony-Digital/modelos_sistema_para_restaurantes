import { redactPii } from './redact.ts'

/** Mensagens do drizzle trazem "\nparams: <valores>" com texto de clientes: corta até os frames da stack (ou o fim). */
export function stripQueryParams(s: string): string {
  return s.replace(/\nparams:[\s\S]*?(?=\n\s+at |$)/g, '\nparams: [redigido]')
}

const mask = (s: string) => redactPii(stripQueryParams(s))

export const SENSITIVE = new Set(['texto', 'text', 'body', 'telefone', 'phone', 'waId', 'to'])

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

function dropSensitive(o: Obj): Obj {
  return Object.fromEntries(Object.entries(o).filter(([k]) => !SENSITIVE.has(k)))
}

type ScrubInput = {
  request?: unknown
  user?: unknown
  extra?: Record<string, unknown>
  message?: string
  exception?: { values?: Array<{ value?: string }> }
  contexts?: Record<string, unknown>
  breadcrumbs?: Array<{ data?: Record<string, unknown>; message?: string }>
}

/** Remove PII de eventos do Sentry (web e worker). */
export function scrubEvent<T extends ScrubInput>(event: T): T {
  const out = { ...event }
  if (out.request && typeof out.request === 'object') {
    const rest: Obj = { ...(out.request as Obj) }
    delete rest.data
    delete rest.cookies
    out.request = rest
  }
  delete out.user
  if (out.extra) out.extra = dropSensitive(out.extra)
  if (typeof out.message === 'string') out.message = mask(out.message)
  if (out.exception?.values) {
    out.exception = {
      ...out.exception,
      values: out.exception.values.map((v) => (typeof v.value === 'string' ? { ...v, value: mask(v.value) } : v)),
    }
  }
  if (out.contexts) {
    out.contexts = Object.fromEntries(
      Object.entries(out.contexts).map(([k, v]) => [k, isObj(v) ? dropSensitive(v) : v]),
    )
  }
  if (out.breadcrumbs) {
    out.breadcrumbs = out.breadcrumbs.map((b) => ({
      ...b,
      ...(b.data ? { data: dropSensitive(Object.fromEntries(Object.entries(b.data).filter(([k]) => k !== 'arguments'))) } : {}),
      ...(typeof b.message === 'string' ? { message: mask(b.message) } : {}),
    }))
  }
  return out
}
