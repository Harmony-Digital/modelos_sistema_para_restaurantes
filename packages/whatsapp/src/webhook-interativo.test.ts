import { describe, expect, it } from 'vitest'
import { parseWebhook } from './webhook-schema.ts'

const corpo = (mensagem: Record<string, unknown>) => ({
  object: 'whatsapp_business_account',
  entry: [{
    id: 'waba',
    changes: [{
      field: 'messages',
      value: {
        messaging_product: 'whatsapp',
        metadata: { phone_number_id: '123', display_phone_number: '556100000000' },
        contacts: [{ wa_id: '5561999998888', profile: { name: 'Maria' } }],
        messages: [{ id: 'wamid.in.1', from: '5561999998888', timestamp: '1791200000', ...mensagem }],
      },
    }],
  }],
})

describe('resposta interativa', () => {
  it('lista: texto = título, interativoId = id da linha', () => {
    const { inbound } = parseWebhook(corpo({
      type: 'interactive',
      interactive: { type: 'list_reply', list_reply: { id: 'u-asa-norte', title: 'Asa Norte', description: 'Brasília' } },
    }), '123')
    expect(inbound[0]).toMatchObject({ tipo: 'texto', texto: 'Asa Norte', interativoId: 'u-asa-norte' })
  })
  it('texto comum: interativoId nulo', () => {
    const { inbound } = parseWebhook(corpo({ type: 'text', text: { body: 'oi' } }), '123')
    expect(inbound[0]!.interativoId).toBeNull()
  })
})
