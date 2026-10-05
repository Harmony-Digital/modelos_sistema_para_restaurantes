import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'

export function keyFromBase64(b64: string): Buffer {
  const key = Buffer.from(b64, 'base64')
  if (key.length !== 32) throw new Error('A chave precisa ter 32 bytes')
  return key
}

export function encryptPhone(plain: string, key: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return ['v1', iv.toString('base64url'), ct.toString('base64url'), tag.toString('base64url')].join('.')
}

export function decryptPhone(token: string, key: Buffer): string {
  const [version, iv, ct, tag] = token.split('.')
  if (version !== 'v1' || !iv || !ct || !tag) throw new Error('Cifra em formato inválido')
  const ivBuf = Buffer.from(iv, 'base64url')
  const tagBuf = Buffer.from(tag, 'base64url')
  if (ivBuf.length !== 12 || tagBuf.length !== 16) throw new Error('Cifra em formato inválido')
  const decipher = createDecipheriv('aes-256-gcm', key, ivBuf, { authTagLength: 16 })
  decipher.setAuthTag(tagBuf)
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8')
}

export function normalizeWaId(waId: string): string {
  return waId.replace(/\D/g, '')
}

export function hashWaId(waId: string, pepper: Buffer): string {
  return createHmac('sha256', pepper).update(normalizeWaId(waId)).digest('hex')
}
