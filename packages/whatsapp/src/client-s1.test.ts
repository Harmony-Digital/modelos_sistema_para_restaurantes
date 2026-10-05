import { describe, expect, it } from 'vitest'
import { createWhatsAppClient } from './client.ts'

function cliente() {
  const corpos: Record<string, unknown>[] = []
  const fetch = (async (_url: string, init: RequestInit) => {
    corpos.push(JSON.parse(String(init.body)))
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.out.1' }] }), { status: 200 })
  }) as unknown as typeof globalThis.fetch
  return { corpos, wa: createWhatsAppClient({ accessToken: 't', phoneNumberId: '1', graphVersion: 'v24.0', fetch }) }
}

describe('mensagens de S1', () => {
  it('localização', async () => {
    const { corpos, wa } = cliente()
    expect(await wa.sendLocation('5561999998888', { lat: -15.8136, lng: -47.896, nome: 'Asa Sul', endereco: 'SCLS 404 Bloco C' }))
      .toEqual({ ok: true, wamid: 'wamid.out.1' })
    expect(corpos[0]).toEqual({
      messaging_product: 'whatsapp', recipient_type: 'individual', to: '5561999998888', type: 'location',
      location: { latitude: -15.8136, longitude: -47.896, name: 'Asa Sul', address: 'SCLS 404 Bloco C' },
    })
  })

  it('lista interativa respeitando os limites da Meta', async () => {
    const { corpos, wa } = cliente()
    const opcoes = Array.from({ length: 12 }, (_, i) => ({ id: `u-${i}`, titulo: `Unidade com nome bem comprido ${i}`, descricao: 'x'.repeat(100) }))
    await wa.sendList('5561999998888', { corpo: 'De qual unidade?', botao: 'Ver unidades disponíveis agora', opcoes })
    const msg = corpos[0] as { type: string; interactive: { type: string; body: { text: string }; action: { button: string; sections: { title: string; rows: { id: string; title: string; description: string }[] }[] } } }
    expect(msg.type).toBe('interactive')
    expect(msg.interactive.type).toBe('list')
    expect(msg.interactive.body.text).toBe('De qual unidade?')
    expect(msg.interactive.action.button).toHaveLength(20)
    const rows = msg.interactive.action.sections[0]!.rows
    expect(rows).toHaveLength(10)
    expect(rows[0]!.title).toHaveLength(24)
    expect(rows[0]!.description).toHaveLength(72)
    expect(rows[0]!.id).toBe('u-0')
  })
})
