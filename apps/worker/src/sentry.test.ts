import { describe, expect, it } from 'vitest'
import { scrubEvent } from './sentry.ts'

describe('scrubEvent', () => {
  it('remove corpo de requisição, usuário e campos sensíveis', () => {
    const ev = scrubEvent({
      request: { url: '/x', data: '{"texto":"oi"}' },
      user: { id: '1', ip_address: '1.2.3.4' },
      extra: { conversationId: 'c1', texto: 'oi', telefone: '556199' },
    })
    expect(ev.request).toEqual({ url: '/x' })
    expect(ev.user).toBeUndefined()
    expect(ev.extra).toEqual({ conversationId: 'c1' })
  })
})
