import pino from 'pino'
import { redactPii } from '@atd/core'
import { stripQueryParams } from '@atd/core/scrub'

const SENSITIVE = ['texto', 'text', 'body', 'telefone', 'phone', 'waId', 'to']
const paths = SENSITIVE.flatMap((k) => [k, `*.${k}`, `*.*.${k}`])

type Serialized = Record<string, unknown>

/** Erros do drizzle/pg carregam params/query com dados de clientes na mensagem e nos campos. */
export function serializeErr(err: unknown, depth = 0): unknown {
  const s = pino.stdSerializers.err(err as Error) as Serialized
  if (!s || typeof s !== 'object') return s
  delete s.params
  delete s.parameters
  delete s.query
  for (const k of ['message', 'detail', 'stack'] as const) {
    if (typeof s[k] === 'string') s[k] = redactPii(stripQueryParams(s[k]))
  }
  const cause = (err as { cause?: unknown } | null)?.cause
  if (cause instanceof Error && depth < 5) s.cause = serializeErr(cause, depth + 1)
  else delete s.cause
  return s
}

export function createLogger(level: string, destination?: pino.DestinationStream) {
  return pino(
    { level, redact: { paths, censor: '[redigido]' }, base: { service: 'worker' }, serializers: { err: serializeErr } },
    destination,
  )
}

export type Logger = pino.Logger
