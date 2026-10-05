import * as Sentry from '@sentry/node'

const SENSITIVE = new Set(['texto', 'text', 'body', 'telefone', 'phone', 'waId', 'to'])

export function scrubEvent<T extends { request?: unknown; user?: unknown; extra?: Record<string, unknown> }>(event: T): T {
  const out = { ...event }
  if (out.request && typeof out.request === 'object') {
    const rest: Record<string, unknown> = { ...(out.request as Record<string, unknown>) }
    delete rest.data
    delete rest.cookies
    out.request = rest
  }
  delete out.user
  if (out.extra) out.extra = Object.fromEntries(Object.entries(out.extra).filter(([k]) => !SENSITIVE.has(k)))
  return out
}

export function initSentry(dsn: string | undefined, release: string) {
  if (!dsn) return
  Sentry.init({
    dsn,
    release,
    environment: process.env.NODE_ENV ?? 'development',
    // v11 substituiu sendDefaultPii por dataCollection: desliga tudo que possa carregar PII.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpBodies: [],
      urlQueryParams: false,
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      stackFrameVariables: false,
    },
    tracesSampleRate: 0.1,
    beforeSend: (event) => scrubEvent(event),
  })
}

export { Sentry }
