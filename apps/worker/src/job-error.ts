import { redactPii } from '@atd/core'
import { stripQueryParams } from '@atd/core/scrub'

/**
 * O pg-boss 12 serializa o erro lançado em pgboss.job.output. Erros do drizzle trazem
 * "\nparams: ..." com texto e dados do cliente: relançar só a mensagem sem params, mascarada e curta.
 */
export function sanitizeJobError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err)
  return new Error(redactPii(stripQueryParams(String(message))).slice(0, 500))
}
