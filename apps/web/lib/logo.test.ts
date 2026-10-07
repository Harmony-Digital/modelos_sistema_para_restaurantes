import { afterEach, describe, expect, it, vi } from 'vitest'
import { LIMITE_LOGO_BYTES, urlPublicaLogo, validarImagemLogo } from './logo'

const bytes = (...partes: (number[] | string)[]) =>
  new Uint8Array(partes.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)))
const corpo = new Array(200).fill(0)
// cabeçalhos mínimos de verdade: PNG com o bloco IHDR, JPEG com marcador depois do SOI, WebP com o bloco VP8/VP8L/VP8X
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], 'IHDR', corpo)
const JPG = bytes([0xff, 0xd8, 0xff, 0xe0], corpo)
const WEBP = bytes('RIFF', [1, 2, 3, 4], 'WEBPVP8 ', corpo)

describe('validarImagemLogo', () => {
  it('aceita PNG, JPG e WebP pelos bytes', () => {
    expect(validarImagemLogo(PNG)).toEqual({ ok: true, mime: 'image/png', ext: 'png' })
    expect(validarImagemLogo(JPG)).toEqual({ ok: true, mime: 'image/jpeg', ext: 'jpg' })
    expect(validarImagemLogo(WEBP)).toEqual({ ok: true, mime: 'image/webp', ext: 'webp' })
    expect(validarImagemLogo(bytes('RIFF', [1, 2, 3, 4], 'WEBPVP8L', corpo)).ok).toBe(true)
    expect(validarImagemLogo(bytes('RIFF', [1, 2, 3, 4], 'WEBPVP8X', corpo)).ok).toBe(true)
  })

  it('recusa arquivo truncado que só tem a assinatura', () => {
    const erro = { ok: false, erro: 'A imagem parece incompleta ou corrompida. Envie o arquivo de novo.' }
    expect(validarImagemLogo(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toEqual(erro)
    expect(validarImagemLogo(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], 'IHDR'))).toEqual(erro)
    // PNG sem o IHDR logo depois da assinatura
    expect(validarImagemLogo(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], 'XXXX', corpo))).toEqual(erro)
    expect(validarImagemLogo(bytes([0xff, 0xd8, 0xff]))).toEqual(erro)
    expect(validarImagemLogo(bytes([0xff, 0xd8, 0xff, 0xe0], new Array(20).fill(0)))).toEqual(erro)
    expect(validarImagemLogo(bytes('RIFF', [1, 2, 3, 4], 'WEBP'))).toEqual(erro)
    expect(validarImagemLogo(bytes('RIFF', [1, 2, 3, 4], 'WEBPXXXX', corpo))).toEqual(erro)
  })

  it('recusa SVG, PDF renomeado para .png e outros formatos', () => {
    const erro = { ok: false, erro: 'Envie a logo em PNG, JPG ou WebP (SVG não é aceito).' }
    expect(validarImagemLogo(bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toEqual(erro)
    expect(validarImagemLogo(bytes('<?xml version="1.0"?><svg/>'))).toEqual(erro)
    expect(validarImagemLogo(bytes('%PDF-1.7 ...'))).toEqual(erro)
    expect(validarImagemLogo(bytes('GIF89a....'))).toEqual(erro)
    // assinatura do PNG pela metade não basta
    expect(validarImagemLogo(bytes([0x89, 0x50, 0x4e, 0x47], '<svg/>', corpo))).toEqual(erro)
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
