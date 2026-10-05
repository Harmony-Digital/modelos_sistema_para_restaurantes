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
})
