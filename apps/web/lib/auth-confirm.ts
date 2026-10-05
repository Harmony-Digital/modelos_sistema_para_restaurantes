/** Aceita só caminhos internos. Recusa `//host`, `/\host`, esquemas, controles e vazio. */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/'
  if (next.includes('\\') || /[\u0000-\u001f\u007f]/.test(next)) return '/'
  return next
}

const ERRO = '/auth/erro?motivo=link'

export async function confirmEmailLink(
  verify: (p: { token_hash: string; type: 'invite' }) => Promise<{ error: unknown }>,
  url: URL,
): Promise<string> {
  const token_hash = url.searchParams.get('token_hash')
  const type = url.searchParams.get('type')
  if (!token_hash || type !== 'invite') return ERRO
  const { error } = await verify({ token_hash, type })
  return error ? ERRO : safeNext(url.searchParams.get('next'))
}

/**
 * Sessão criada pelo link de convite (`verifyOtp`). O GoTrue registra esse login
 * em `amr` com método `otp` (verificado localmente; não existe método `invite`).
 * `/auth/confirm` só aceita `type=invite`, então `otp` aqui significa convite.
 */
export function isInviteSession(claims: { amr?: unknown } | null | undefined): boolean {
  const amr = claims?.amr
  return Array.isArray(amr) && amr.some((e) => typeof e === 'object' && e !== null && (e as { method?: unknown }).method === 'otp')
}
