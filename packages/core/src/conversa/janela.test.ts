import { describe, expect, it } from 'vitest'
import { dentroDaJanela } from './index.ts'

describe('janela de 24 h', () => {
  const agora = new Date('2026-10-06T12:00:00Z')
  it('aberta antes do vencimento', () => {
    expect(dentroDaJanela(new Date('2026-10-06T12:00:00.001Z'), agora)).toBe(true)
  })
  it('limite exato já está fora (window_expires_at > now())', () => {
    expect(dentroDaJanela(new Date('2026-10-06T12:00:00Z'), agora)).toBe(false)
  })
  it('vencida', () => {
    expect(dentroDaJanela(new Date('2026-10-05T12:00:00Z'), agora)).toBe(false)
  })
  it('sem janela (cliente nunca escreveu) ⇒ fora', () => {
    expect(dentroDaJanela(null, agora)).toBe(false)
  })
})
