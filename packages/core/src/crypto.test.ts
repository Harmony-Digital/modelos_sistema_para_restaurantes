import { describe, expect, it } from 'vitest'
import { decryptPhone, encryptPhone, hashWaId, keyFromBase64 } from './crypto.ts'

const key = keyFromBase64(Buffer.alloc(32, 1).toString('base64'))
const otherKey = keyFromBase64(Buffer.alloc(32, 2).toString('base64'))

describe('cifra do telefone', () => {
  it('ida e volta', () => {
    expect(decryptPhone(encryptPhone('5561999998888', key), key)).toBe('5561999998888')
  })
  it('IV aleatório: mesma entrada gera cifras diferentes', () => {
    expect(encryptPhone('5561999998888', key)).not.toBe(encryptPhone('5561999998888', key))
  })
  it('detecta adulteração', () => {
    const [v, iv, ct, tag] = encryptPhone('5561999998888', key).split('.')
    const flipped = Buffer.from(ct!, 'base64url')
    flipped[0] = flipped[0]! ^ 1
    expect(() => decryptPhone([v, iv, flipped.toString('base64url'), tag].join('.'), key)).toThrow()
  })
  it('chave errada falha', () => {
    expect(() => decryptPhone(encryptPhone('5561999998888', key), otherKey)).toThrow()
  })
  it('formato inválido falha com mensagem clara', () => {
    expect(() => decryptPhone('lixo', key)).toThrow(/formato/)
  })
  it('rejeita chave de tamanho errado', () => {
    expect(() => keyFromBase64(Buffer.alloc(16).toString('base64'))).toThrow(/32 bytes/)
  })
})

describe('cifra — tamanhos de IV e tag', () => {
  it('rejeita tag truncada de 4 bytes', () => {
    const [v, iv, ct, tag] = encryptPhone('5561999998888', key).split('.')
    const short = Buffer.from(tag!, 'base64url').subarray(0, 4).toString('base64url')
    expect(() => decryptPhone([v, iv, ct, short].join('.'), key)).toThrow(/formato/)
  })
  it('rejeita IV que não tem 12 bytes', () => {
    const [v, , ct, tag] = encryptPhone('5561999998888', key).split('.')
    const iv = Buffer.alloc(8).toString('base64url')
    expect(() => decryptPhone([v, iv, ct, tag].join('.'), key)).toThrow(/formato/)
  })
})

describe('hash do wa_id', () => {
  it('determinístico e independente de formatação', () => {
    expect(hashWaId('+55 (61) 99999-8888', key)).toBe(hashWaId('5561999998888', key))
  })
  it('depende do pepper e não contém o número', () => {
    const h = hashWaId('5561999998888', key)
    expect(h).not.toBe(hashWaId('5561999998888', otherKey))
    expect(h).not.toContain('99999')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })
})
