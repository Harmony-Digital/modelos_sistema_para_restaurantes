import { describe, expect, it, vi } from 'vitest'
import { createWhatsAppClient } from './client.ts'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const make = (impl: typeof fetch) =>
  createWhatsAppClient({ accessToken: 'TOKEN', phoneNumberId: '111', graphVersion: 'v24.0', fetch: impl })

describe('sendText', () => {
  it('envia e devolve o wamid', async () => {
    const f = vi.fn(async () => json(200, { messages: [{ id: 'wamid.OUT1' }] }))
    expect(await make(f).sendText('5561999998888', 'olá')).toEqual({ ok: true, wamid: 'wamid.OUT1' })
    const [url, init] = f.mock.calls[0]! as unknown as [string, RequestInit]
    expect(url).toBe('https://graph.facebook.com/v24.0/111/messages')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer TOKEN')
    expect(JSON.parse(String(init.body))).toEqual({
      messaging_product: 'whatsapp', recipient_type: 'individual', to: '5561999998888',
      type: 'text', text: { preview_url: false, body: 'olá' },
    })
  })
  it('janela de 24h expirada (131047) é permanente', async () => {
    const r = await make(async () => json(400, { error: { code: 131047, message: 'Re-engagement' } })).sendText('1', 'x')
    expect(r).toEqual({ ok: false, retryable: false, code: 131047, message: 'Re-engagement' })
  })
  it('5xx e rate limit são temporários', async () => {
    const r1 = await make(async () => json(503, {})).sendText('1', 'x')
    const r2 = await make(async () => json(400, { error: { code: 130429, message: 'rate' } })).sendText('1', 'x')
    expect(r1.ok === false && r1.retryable).toBe(true)
    expect(r2.ok === false && r2.retryable).toBe(true)
  })
  it('falha de rede é temporária', async () => {
    const r = await make(async () => { throw new TypeError('fetch failed') }).sendText('1', 'x')
    expect(r).toMatchObject({ ok: false, retryable: true, code: null })
  })
  it('corta texto acima de 4096 caracteres', async () => {
    const f = vi.fn(async () => json(200, { messages: [{ id: 'w' }] }))
    await make(f).sendText('1', 'a'.repeat(5000))
    const body = JSON.parse(String((f.mock.calls[0]! as unknown as [string, RequestInit])[1].body))
    expect(body.text.body).toHaveLength(4096)
  })
})
