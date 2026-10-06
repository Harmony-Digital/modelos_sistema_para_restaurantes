import { describe, expect, it, vi } from 'vitest'
import { createStorage, MAX_OBJETO_BYTES } from './storage.ts'

const URL_BASE = 'http://127.0.0.1:54321'
const CHAVE = 'chave-de-servico-bem-longa-0123456789'
const make = (f: typeof fetch) => createStorage({ url: `${URL_BASE}/`, serviceRoleKey: CHAVE, fetch: f })

describe('baixarObjeto (Storage por REST, chave de serviço)', () => {
  it('GET /storage/v1/object/{bucket}/{caminho} com a chave de serviço; devolve os bytes', async () => {
    const f = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])))
    const bytes = await make(f).baixarObjeto('cardapio', 'c0ffee00-0000-4000-8000-000000000001/menu da casa.pdf')
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]))
    const [url, init] = f.mock.calls[0]! as unknown as [string, RequestInit]
    expect(url).toBe(`${URL_BASE}/storage/v1/object/cardapio/c0ffee00-0000-4000-8000-000000000001/menu%20da%20casa.pdf`)
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${CHAVE}`)
    expect((init.headers as Record<string, string>).apikey).toBe(CHAVE)
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('objeto inexistente ou erro do Storage: lança sem a chave na mensagem', async () => {
    const erro = await make(async () => new Response('{"message":"Object not found"}', { status: 404 }))
      .baixarObjeto('cardapio', 'x/a.pdf').catch((e: Error) => e)
    expect(erro).toBeInstanceOf(Error)
    expect((erro as Error).message).toContain('404')
    expect((erro as Error).message).not.toContain(CHAVE)
  })

  it('acima de 20 MB é recusado (pelo cabeçalho ou pelo corpo)', async () => {
    expect(MAX_OBJETO_BYTES).toBe(20 * 1024 * 1024)
    const grande = new Response(new Uint8Array(1), { headers: { 'content-length': String(MAX_OBJETO_BYTES + 1) } })
    await expect(make(async () => grande).baixarObjeto('cardapio', 'x/a.pdf')).rejects.toThrow(/20 MB/)
    const corpoGrande = new Response(new Uint8Array(MAX_OBJETO_BYTES + 1))
    await expect(make(async () => corpoGrande).baixarObjeto('cardapio', 'x/a.pdf')).rejects.toThrow(/20 MB/)
  })

  it('caminho com ".." ou bucket inválido é recusado antes da rede', async () => {
    const f = vi.fn()
    await expect(make(f as unknown as typeof fetch).baixarObjeto('cardapio', '../segredo')).rejects.toThrow()
    await expect(make(f as unknown as typeof fetch).baixarObjeto('../x', 'a/b.pdf')).rejects.toThrow()
    expect(f).not.toHaveBeenCalled()
  })
})
