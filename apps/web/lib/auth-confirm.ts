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
 * método `otp` com `timestamp` (segundos); só vale na última hora (não existe método `invite`). Atenção:
 * `otp` também ocorre em magic link/OTP por e-mail, então isto sozinho não prova
 * convite; use `podeDefinirSenha`, que também confere o nível de MFA.
 */
export const JANELA_CONVITE_S = 3600
/** Tolerância a relógio adiantado do servidor de auth em relação ao app. */
export const TOLERANCIA_RELOGIO_S = 60

export function isInviteSession(
  claims: { amr?: unknown } | null | undefined,
  now: number = Date.now(),
): boolean {
  const amr = claims?.amr
  if (!Array.isArray(amr)) return false
  const agoraS = now / 1000
  // O login por link precisa ser recente: sessão antiga com `otp` não troca senha.
  return amr.some((e) => {
    if (typeof e !== 'object' || e === null) return false
    const { method, timestamp } = e as { method?: unknown; timestamp?: unknown }
    return method === 'otp' && typeof timestamp === 'number' && agoraS - timestamp >= -TOLERANCIA_RELOGIO_S && agoraS - timestamp <= JANELA_CONVITE_S
  })
}

/**
 * Defesa em profundidade: além de vir de `otp`, quem já tem fator MFA verificado
 * (nextLevel aal2) precisa estar em aal2; senão não pode trocar a senha por aqui.
 */
export function podeDefinirSenha(
  claims: { amr?: unknown } | null | undefined,
  aal: { currentLevel: string | null; nextLevel: string | null },
  now: number = Date.now(),
): boolean {
  if (!isInviteSession(claims, now)) return false
  return !(aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2')
}
