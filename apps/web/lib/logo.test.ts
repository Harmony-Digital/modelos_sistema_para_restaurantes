import { afterEach, describe, expect, it, vi } from 'vitest'
import { LIMITE_LOGO_BYTES, urlPublicaLogo, validarImagemLogo } from './logo'

const bytes = (...partes: (number[] | string)[]) =>
  new Uint8Array(partes.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)))
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'resto')
const JPG = bytes([0xff, 0xd8, 0xff, 0xe0], 'resto')
const WEBP = bytes('RIFF', [1, 2, 3, 4], 'WEBPVP8 ')

describe('validarImagemLogo', () => {
  it('aceita PNG, JPG e WebP pelos bytes', () => {
    expect(validarImagemLogo(PNG)).toEqual({ ok: true, mime: 'image/png', ext: 'png' })
    expect(validarImagemLogo(JPG)).toEqual({ ok: true, mime: 'image/jpeg', ext: 'jpg' })
    expect(validarImagemLogo(WEBP)).toEqual({ ok: true, mime: 'image/webp', ext: 'webp' })
  })

  it('recusa SVG, PDF renomeado para .png e outros formatos', () => {
    const erro = { ok: false, erro: 'Envie a logo em PNG, JPG ou WebP (SVG não é aceito).' }
    expect(validarImagemLogo(bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toEqual(erro)
    expect(validarImagemLogo(bytes('<?xml version="1.0"?><svg/>'))).toEqual(erro)
    expect(validarImagemLogo(bytes('%PDF-1.7 ...'))).toEqual(erro)
    expect(validarImagemLogo(bytes('GIF89a....'))).toEqual(erro)
    // assinatura do PNG pela metade não basta
    expect(validarImagemLogo(bytes([0x89, 0x50, 0x4e, 0x47], '<svg/>'))).toEqual(erro)
  })

  it('recusa vazio e acima de 1 MB (pelo tamanho declarado ou pelos bytes)', () => {
    expect(validarImagemLogo(new Uint8Array())).toEqual({ ok: false, erro: 'O arquivo está vazio.' })
    const grande = { ok: false, erro: 'A logo passa de 1 MB. Envie uma imagem menor.' }
    expect(validarImagemLogo(PNG, LIMITE_LOGO_BYTES + 1)).toEqual(grande)
    const cheio = new Uint8Array(LIMITE_LOGO_BYTES + 1)
    cheio.set(PNG)
    expect(validarImagemLogo(cheio)).toEqual(grande)
    const limite = new Uint8Array(LIMITE_LOGO_BYTES)
    limite.set(PNG)
    expect(validarImagemLogo(limite).ok).toBe(true)
  })
})

describe('urlPublicaLogo', () => {
  afterEach(() => vi.unstubAllEnvs())
  it('monta a URL pública do bucket marca; sem caminho, nada', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abc.supabase.co/')
    expect(urlPublicaLogo(`r1/logo-${'a'.repeat(64)}.png`)).toBe(`https://abc.supabase.co/storage/v1/object/public/marca/r1/logo-${'a'.repeat(64)}.png`)
    expect(urlPublicaLogo(null)).toBeNull()
  })
})
