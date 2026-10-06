import { describe, expect, it, vi } from 'vitest'
import { createOpenRouterClient, type ConteudoUsuario } from './openrouter.ts'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

async function corpo(userParts: ConteudoUsuario[] | undefined, semZdrDev = false) {
  const f = vi.fn(async () => json(200, { model: 'm', choices: [{ message: { content: '{"a":1}' } }] }))
  const r = await createOpenRouterClient({ apiKey: 'KEY', appTitle: 'A', fetch: f, semZdrDev }).completeJson({
    models: ['m'], system: 'sys', user: 'leia o anexo', ...(userParts ? { userParts } : {}),
    schemaName: 'x', jsonSchema: { type: 'object' }, parse: (raw) => raw, maxTokens: 5,
  })
  expect(r.ok).toBe(true)
  return JSON.parse(String((f.mock.calls[0]! as unknown as [string, RequestInit])[1].body)) as Record<string, unknown> & {
    messages: { role: string; content: unknown }[]
  }
}

describe('OpenRouter completeJson — mensagem multimodal', () => {
  it('sem partes: content do user continua string e não há plugins', async () => {
    const b = await corpo(undefined)
    expect(b.messages[1]).toEqual({ role: 'user', content: 'leia o anexo' })
    expect(b.plugins).toBeUndefined()
  })

  it('imagem: texto primeiro, depois image_url com data URL; sem plugin de PDF', async () => {
    const b = await corpo([{ type: 'image', mime: 'image/png', base64: 'iVBORw0K' }])
    expect(b.messages[1]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'leia o anexo' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0K' } },
      ],
    })
    expect(b.plugins).toBeUndefined()
    expect(b.provider).toEqual({ data_collection: 'deny', zdr: true })
  })

  it('PDF: parte file com file_data e plugin file-parser com motor nativo; provider estrito presente', async () => {
    const b = await corpo([{ type: 'pdf', filename: 'cardapio.pdf', base64: 'JVBERi0x' }, { type: 'text', text: 'extra' }])
    expect(b.messages[1]!.content).toEqual([
      { type: 'text', text: 'leia o anexo' },
      { type: 'file', file: { filename: 'cardapio.pdf', file_data: 'data:application/pdf;base64,JVBERi0x' } },
      { type: 'text', text: 'extra' },
    ])
    expect(b.plugins).toEqual([{ id: 'file-parser', pdf: { engine: 'native' } }])
    expect(b.provider).toEqual({ data_collection: 'deny', zdr: true })
    expect(b.messages[0]).toEqual({ role: 'system', content: 'sys' })
  })

  it('modo dev sem ZDR: multimodal sem provider, plugin mantido', async () => {
    const b = await corpo([{ type: 'pdf', filename: 'a.pdf', base64: 'JVBERi0x' }], true)
    expect(b.provider).toBeUndefined()
    expect(b.plugins).toEqual([{ id: 'file-parser', pdf: { engine: 'native' } }])
  })

  it('timeout por chamada sobrepõe o do cliente', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout')
    const f = vi.fn(async () => json(200, { model: 'm', choices: [{ message: { content: '{}' } }] }))
    const llm = createOpenRouterClient({ apiKey: 'K', appTitle: 'A', fetch: f })
    await llm.completeJson({ models: ['m'], system: 's', user: 'u', schemaName: 'x', jsonSchema: {}, parse: (r) => r, maxTokens: 5, timeoutMs: 90_000 })
    await llm.completeJson({ models: ['m'], system: 's', user: 'u', schemaName: 'x', jsonSchema: {}, parse: (r) => r, maxTokens: 5 })
    expect(spy.mock.calls.map((c) => c[0])).toEqual([90_000, 20_000])
    spy.mockRestore()
  })
})
