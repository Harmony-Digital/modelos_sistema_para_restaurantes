import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyChallenge, verifySignature } from './signature.ts'

const secret = 'app-secret'
const body = '{"object":"whatsapp_business_account"}'
const sign = (b: string, s = secret) => `sha256=${createHmac('sha256', s).update(b).digest('hex')}`

describe('verifySignature', () => {
  it('aceita assinatura correta', () => expect(verifySignature(body, sign(body), secret)).toBe(true))
  it('rejeita corpo alterado', () => expect(verifySignature(body + ' ', sign(body), secret)).toBe(false))
  it('rejeita segredo errado', () => expect(verifySignature(body, sign(body, 'outro'), secret)).toBe(false))
  it('rejeita header ausente, sem prefixo ou truncado', () => {
    expect(verifySignature(body, null, secret)).toBe(false)
    expect(verifySignature(body, sign(body).slice(7), secret)).toBe(false)
    expect(verifySignature(body, sign(body).slice(0, 20), secret)).toBe(false)
  })
})

describe('verifySignature (rigor)', () => {
  it('rejeita hex com lixo no final ou nibble ímpar', () => {
    expect(verifySignature(body, sign(body) + 'zz', secret)).toBe(false)
    expect(verifySignature(body, sign(body) + 'a', secret)).toBe(false)
  })
  it('rejeita segredo vazio', () => expect(verifySignature(body, sign(body, ''), '')).toBe(false))
})

describe('verifySignature (bytes)', () => {
  it('aceita Buffer e assina os bytes brutos, inclusive não-UTF-8', () => {
    const raw = Buffer.from([0x7b, 0xff, 0xfe, 0x7d])
    const h = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`
    expect(verifySignature(raw, h, secret)).toBe(true)
    expect(verifySignature(Buffer.from(body), sign(body), secret)).toBe(true)
    expect(verifySignature(Buffer.from(body + ' '), sign(body), secret)).toBe(false)
  })
})

describe('verifyChallenge', () => {
  it('devolve o challenge com token correto', () => {
    const p = new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': 'tok', 'hub.challenge': '42' })
    expect(verifyChallenge(p, 'tok')).toBe('42')
  })
  it('null com token errado ou modo errado', () => {
    expect(verifyChallenge(new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': 'x', 'hub.challenge': '42' }), 'tok')).toBeNull()
    expect(verifyChallenge(new URLSearchParams({ 'hub.mode': 'other', 'hub.verify_token': 'tok', 'hub.challenge': '42' }), 'tok')).toBeNull()
  })
})
