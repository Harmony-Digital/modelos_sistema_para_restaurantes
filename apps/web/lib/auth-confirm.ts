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
 * Sessão iniciada por `verifyOtp`. O GoTrue registra esse login em `amr` com
 * método `otp` (verificado localmente; não existe método `invite`). Atenção:
 * `otp` também ocorre em magic link/OTP por e-mail, então isto sozinho não prova
 * convite; use `podeDefinirSenha`, que também confere o nível de MFA.
 */
export function isInviteSession(claims: { amr?: unknown } | null | undefined): boolean {
  const amr = claims?.amr
  return Array.isArray(amr) && amr.some((e) => typeof e === 'object' && e !== null && (e as { method?: unknown }).method === 'otp')
}

/**
 * Defesa em profundidade: além de vir de `otp`, quem já tem fator MFA verificado
 * (nextLevel aal2) precisa estar em aal2; senão não pode trocar a senha por aqui.
 */
export function podeDefinirSenha(
  claims: { amr?: unknown } | null | undefined,
  aal: { currentLevel: string | null; nextLevel: string | null },
): boolean {
  if (!isInviteSession(claims)) return false
  return !(aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2')
}
