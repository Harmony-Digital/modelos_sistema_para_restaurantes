import { describe, expect, it, vi } from 'vitest'
import { createWhatsAppClient } from './client.ts'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const make = (impl: typeof fetch) =>
  createWhatsAppClient({ accessToken: 'TOKEN', phoneNumberId: '111', graphVersion: 'v24.0', fetch: impl })

const corpoJson = (f: ReturnType<typeof vi.fn>) =>
  JSON.parse(String((f.mock.calls[0]! as unknown as [string, RequestInit])[1].body)) as Record<string, unknown>

describe('uploadMedia', () => {
  it('multipart em /{phone}/media com messaging_product, type e file; devolve o id', async () => {
    const f = vi.fn(async () => json(200, { id: 'MEDIA1' }))
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46])
    expect(await make(f).uploadMedia(bytes, 'application/pdf', 'cardapio.pdf')).toEqual({ ok: true, mediaId: 'MEDIA1' })
    const [url, init] = f.mock.calls[0]! as unknown as [string, RequestInit]
    expect(url).toBe('https://graph.facebook.com/v24.0/111/media')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer TOKEN')
    // o fetch monta o boundary: nunca fixar Content-Type à mão
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined()
    const form = init.body as FormData
    expect(form).toBeInstanceOf(FormData)
    expect(form.get('messaging_product')).toBe('whatsapp')
    expect(form.get('type')).toBe('application/pdf')
    const file = form.get('file') as File
    expect(file.name).toBe('cardapio.pdf')
    expect(file.type).toBe('application/pdf')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes)
  })
  it('erro da Meta: código e temporário/permanente', async () => {
    const perm = await make(async () => json(400, { error: { code: 131053, message: 'Media upload error' } })).uploadMedia(new Uint8Array([1]), 'image/png', 'a.png')
    expect(perm).toEqual({ ok: false, retryable: false, code: 131053, message: 'Media upload error' })
    const temp = await make(async () => json(503, {})).uploadMedia(new Uint8Array([1]), 'image/png', 'a.png')
    expect(temp).toMatchObject({ ok: false, retryable: true })
  })
  it('falha de rede e resposta sem id', async () => {
    expect(await make(async () => { throw new TypeError('fetch failed') }).uploadMedia(new Uint8Array([1]), 'image/png', 'a.png'))
      .toMatchObject({ ok: false, retryable: true, code: null })
    expect(await make(async () => json(200, {})).uploadMedia(new Uint8Array([1]), 'image/png', 'a.png'))
      .toMatchObject({ ok: false, retryable: true })
  })
})

describe('sendDocument / sendImage', () => {
  it('documento pelo media id, com nome do arquivo e legenda', async () => {
    const f = vi.fn(async () => json(200, { messages: [{ id: 'wamid.D' }] }))
    expect(await make(f).sendDocument('5561999998888', { mediaId: 'M1', filename: 'cardapio.pdf', caption: 'Cardápio' }))
      .toEqual({ ok: true, wamid: 'wamid.D' })
    expect(corpoJson(f)).toEqual({
      messaging_product: 'whatsapp', recipient_type: 'individual', to: '5561999998888',
      type: 'document', document: { id: 'M1', filename: 'cardapio.pdf', caption: 'Cardápio' },
    })
  })
  it('imagem pelo media id, com legenda', async () => {
    const f = vi.fn(async () => json(200, { messages: [{ id: 'wamid.I' }] }))
    expect(await make(f).sendImage('1', { mediaId: 'M2', caption: 'Cardápio' })).toEqual({ ok: true, wamid: 'wamid.I' })
    expect(corpoJson(f)).toEqual({
      messaging_product: 'whatsapp', recipient_type: 'individual', to: '1', type: 'image', image: { id: 'M2', caption: 'Cardápio' },
    })
  })
  it('legenda cortada em 1024 e nome do arquivo em 240', async () => {
    const f = vi.fn(async () => json(200, { messages: [{ id: 'w' }] }))
    await make(f).sendDocument('1', { mediaId: 'M', filename: `${'a'.repeat(300)}.pdf`, caption: 'b'.repeat(2000) })
    const doc = corpoJson(f).document as { filename: string; caption: string }
    expect(doc.caption).toHaveLength(1024)
    expect(doc.filename).toHaveLength(240)
  })
  it('media id inválido é permanente (o worker refaz o upload)', async () => {
    const r = await make(async () => json(400, { error: { code: 131053, message: 'bad media' } })).sendImage('1', { mediaId: 'X', caption: '' })
    expect(r).toEqual({ ok: false, retryable: false, code: 131053, message: 'bad media' })
  })
})
