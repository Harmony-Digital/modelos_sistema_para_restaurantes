import type { z } from 'zod'

export type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; fieldErrors?: Record<string, string>; formError?: string }

/** Primeira mensagem por campo. Issues sem caminho (refine do objeto) não entram aqui: use `actionErrorFromZod`. */
export function fieldErrorsFromZod(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of err.issues) {
    const key = issue.path.join('.')
    if (key && !(key in out)) out[key] = issue.message
  }
  return out
}

/** Erros por campo + a primeira mensagem sem caminho como erro do formulário. */
export function actionErrorFromZod(err: z.ZodError): { ok: false; fieldErrors: Record<string, string>; formError?: string } {
  const formError = err.issues.find((i) => i.path.length === 0)?.message
  return { ok: false, fieldErrors: fieldErrorsFromZod(err), ...(formError ? { formError } : {}) }
}

export const ERRO_AO_SALVAR = 'Não foi possível salvar. Tente de novo.'

/** Chama a Server Action; exceção (rede, servidor fora) vira erro geral do formulário em vez de sumir. */
export async function chamarAcao<T>(acao: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await acao()
  } catch {
    return { ok: false, formError: ERRO_AO_SALVAR }
  }
}
