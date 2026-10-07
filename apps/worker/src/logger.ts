import pino from 'pino'
import { redactPii } from '@atd/core'
import { stripQueryParams, stripRowValues, stripStackParams } from '@atd/core/scrub'

const SENSITIVE = ['texto', 'text', 'body', 'telefone', 'phone', 'waId', 'to']
const paths = SENSITIVE.flatMap((k) => [k, `*.${k}`, `*.*.${k}`])

type Serialized = Record<string, unknown>

function chainMessages(err: unknown): string[] {
  const out: string[] = []
  for (let e = err, i = 0; e instanceof Error && i < 10; e = e.cause, i++) out.push(e.message)
  return out
}

/** Erros do drizzle/pg carregam params/query com dados de clientes na mensagem e nos campos. */
export function serializeErr(err: unknown, depth = 0): unknown {
  const s = pino.stdSerializers.err(err as Error) as Serialized
  if (!s || typeof s !== 'object') return s
  delete s.params
  delete s.parameters
  delete s.query
  // `detail`/`where` do Postgres trazem os valores da linha (o nome do cliente na reserva): só a forma fica
  for (const k of ['message', 'detail', 'where'] as const) {
    if (typeof s[k] === 'string') s[k] = redactPii(stripRowValues(stripQueryParams(s[k])))
  }
  // o stack do pino dobra as causas ("caused by"), então remove os params de todas as mensagens da cadeia
  if (typeof s.stack === 'string') s.stack = redactPii(stripStackParams(s.stack, chainMessages(err)))
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
