import { createHmac } from 'node:crypto'

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32(segredo: string): Buffer {
  let bits = 0
  let valor = 0
  const bytes: number[] = []
  for (const c of segredo.replace(/\s+/g, '').replace(/=+$/, '').toUpperCase()) {
    const i = ALFABETO.indexOf(c)
    if (i < 0) throw new Error('segredo TOTP inválido')
    valor = ((valor << 5) | i) & 0xffff
    bits += 5
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

/** RFC 6238 (SHA-1, 30 s, 6 dígitos): o mesmo cálculo do app autenticador. */
export function codigoTotp(segredo: string, agoraMs = Date.now()): string {
  const contador = Buffer.alloc(8)
  contador.writeBigUInt64BE(BigInt(Math.floor(agoraMs / 30_000)))
  const h = createHmac('sha1', base32(segredo)).update(contador).digest()
  const o = h[h.length - 1]! & 0x0f
  const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!
  return String(n % 1_000_000).padStart(6, '0')
}
