import * as Sentry from '@sentry/node'
import { scrubEvent } from '@atd/core'

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
      queues: false,
      stackFrameVariables: false,
    },
    tracesSampleRate: 0.1,
    beforeSend: (event) => scrubEvent(event),
    beforeSendTransaction: (event) => scrubEvent(event),
  })
}

export { Sentry, scrubEvent }
