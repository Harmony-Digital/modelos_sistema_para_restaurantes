import pino from 'pino'

const SENSITIVE = ['texto', 'text', 'body', 'telefone', 'phone', 'waId', 'to']
const paths = SENSITIVE.flatMap((k) => [k, `*.${k}`, `*.*.${k}`])

export function createLogger(level: string, destination?: pino.DestinationStream) {
  return pino({ level, redact: { paths, censor: '[redigido]' }, base: { service: 'worker' } }, destination)
}

export type Logger = pino.Logger
