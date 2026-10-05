import { createHmac, timingSafeEqual } from 'node:crypto'

function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Valida X-Hub-Signature-256 sobre o corpo BRUTO (invariante I7). */
export function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!appSecret || !header?.startsWith('sha256=')) return false
  const hex = header.slice(7)
  if (!/^[0-9a-f]{64}$/i.test(hex)) return false
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest()
  return safeEqual(Buffer.from(hex, 'hex'), expected)
}

export function verifyChallenge(params: URLSearchParams, verifyToken: string): string | null {
  const token = params.get('hub.verify_token') ?? ''
  const ok = params.get('hub.mode') === 'subscribe' && safeEqual(Buffer.from(token), Buffer.from(verifyToken))
  return ok ? params.get('hub.challenge') : null
}
