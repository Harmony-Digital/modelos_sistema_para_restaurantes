import { describe, expect, it } from 'vitest'
import { parseWebhook } from './webhook-schema.ts'
import text from './fixtures/text.json' with { type: 'json' }
import audio from './fixtures/audio.json' with { type: 'json' }
import image from './fixtures/image-caption.json' with { type: 'json' }
import status from './fixtures/status.json' with { type: 'json' }
import other from './fixtures/other-number.json' with { type: 'json' }

describe('parseWebhook', () => {
  it('texto', () => {
    const { inbound } = parseWebhook(text, '111')
    expect(inbound).toEqual([
      {
        wamid: 'wamid.TEXT1', waId: '5561999998888', profileName: 'Maria',
        timestamp: new Date(1759680000 * 1000), tipo: 'texto', texto: 'Vocês abrem domingo?', mediaId: null,
      },
    ])
  })
  it('áudio vira tipo audio com mediaId e sem texto', () => {
    const [m] = parseWebhook(audio, '111').inbound
    expect([m!.tipo, m!.texto, m!.mediaId]).toEqual(['audio', null, 'MEDIA1'])
  })
  it('imagem com legenda usa a legenda como texto', () => {
    const [m] = parseWebhook(image, '111').inbound
    expect([m!.tipo, m!.texto]).toEqual(['imagem', 'isso tem no cardápio?'])
  })
  it('status de entrega com código de erro', () => {
    expect(parseWebhook(status, '111').statuses).toEqual([
      { wamid: 'wamid.OUT1', status: 'failed', timestamp: new Date(1759680001 * 1000), errorCode: 131047 },
    ])
  })
  it('ignora eventos de outro número', () => {
    expect(parseWebhook(other, '111')).toEqual({ inbound: [], statuses: [] })
  })
  it('payload que não é da Meta lança', () => {
    expect(() => parseWebhook({ foo: 1 }, '111')).toThrow()
  })

  const wrap = (value: unknown, field = 'messages') => ({ field, value })
  const meta = { phone_number_id: '111' }
  const envelope = (...changes: unknown[]) => ({ object: 'whatsapp_business_account', entry: [{ id: 'W', changes }] })
  const txt = (id: string) => ({ from: '1', id, timestamp: '1759680000', type: 'text', text: { body: 'oi' } })

  it('ignora change sem metadata (account_update) e mantém a mensagem', () => {
    const body = envelope(wrap({ event: 'X' }, 'account_update'), wrap({ metadata: meta, messages: [txt('a')] }))
    expect(parseWebhook(body, '111').inbound.map((m) => m.wamid)).toEqual(['a'])
  })
  it('pula mensagem malformada e devolve a válida', () => {
    const body = envelope(wrap({ metadata: meta, messages: [{ id: 'bad', timestamp: '1', type: 'text' }, txt('ok')] }))
    expect(parseWebhook(body, '111').inbound.map((m) => m.wamid)).toEqual(['ok'])
  })
  it('pula item com timestamp não numérico', () => {
    const body = envelope(
      wrap({ metadata: meta, messages: [{ ...txt('bad'), timestamp: 'abc' }, txt('ok')], statuses: [{ id: 's', status: 'sent', timestamp: 'abc' }] }),
    )
    const r = parseWebhook(body, '111')
    expect(r.inbound.map((m) => m.wamid)).toEqual(['ok'])
    expect(r.statuses).toEqual([])
  })
  it('status sem errors tem errorCode null', () => {
    const body = envelope(wrap({ metadata: meta, statuses: [{ id: 's', status: 'sent', timestamp: '1759680001' }] }))
    expect(parseWebhook(body, '111').statuses[0]!.errorCode).toBeNull()
  })
  it('interactive button_reply vira texto', () => {
    const m = { from: '1', id: 'i', timestamp: '1759680000', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'b', title: 'Sim' } } }
    const [r] = parseWebhook(envelope(wrap({ metadata: meta, messages: [m] })), '111').inbound
    expect([r!.tipo, r!.texto]).toEqual(['texto', 'Sim'])
  })
})
