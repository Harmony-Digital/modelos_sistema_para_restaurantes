import { describe, expect, it, vi } from 'vitest'
import { coordenadasDoLink } from './maps-link'

// o pacote `server-only` lança fora do bundle de servidor do Next
vi.mock('server-only', () => ({}))

const redireciona = (...destinos: (string | null)[]) => {
  let i = 0
  return vi.fn(async () => new Response(null, { status: 302, headers: destinos[i] ? { location: destinos[i++]! } : {} })) as unknown as typeof fetch
}

describe('coordenadasDoLink', () => {
  it('link completo não usa a rede', async () => {
    const f = vi.fn() as unknown as typeof fetch
    expect(await coordenadasDoLink('https://www.google.com/maps/@-15.8,-47.9,17z', f)).toEqual({ lat: -15.8, lng: -47.9 })
    expect(f).not.toHaveBeenCalled()
  })
  it('link curto: segue o redirecionamento para o Google Maps', async () => {
    const f = redireciona('https://www.google.com/maps/place/X/@-15.81,-47.89,17z')
    expect(await coordenadasDoLink('https://maps.app.goo.gl/Ab12', f)).toEqual({ lat: -15.81, lng: -47.89 })
  })
  it('não segue redirecionamento para fora do Google nem além de 3 saltos', async () => {
    expect(await coordenadasDoLink('https://maps.app.goo.gl/Ab12', redireciona('https://evil.com/maps/@1,2'))).toBeNull()
    const curto = 'https://maps.app.goo.gl/Loop'
    expect(await coordenadasDoLink(curto, redireciona(curto, curto, curto, curto))).toBeNull()
    expect(await coordenadasDoLink(curto, redireciona(null))).toBeNull()
    // porta não padrão e http não são seguidos, mesmo em host do Google
    expect(await coordenadasDoLink(curto, redireciona('https://www.google.com:8080/maps/@1,2,17z'))).toBeNull()
    expect(await coordenadasDoLink(curto, redireciona('http://www.google.com/maps/@1,2,17z'))).toBeNull()
    const f2 = vi.fn() as unknown as typeof fetch
    expect(await coordenadasDoLink('https://maps.app.goo.gl:8080/x', f2)).toBeNull()
    expect(f2).not.toHaveBeenCalled()
    const quebra = vi.fn(async () => { throw new Error('rede') }) as unknown as typeof fetch
    expect(await coordenadasDoLink(curto, quebra)).toBeNull()
  })
})
