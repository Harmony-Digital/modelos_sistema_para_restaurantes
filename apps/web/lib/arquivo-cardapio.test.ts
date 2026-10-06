import { afterEach, describe, expect, it, vi } from 'vitest'
import { LIMITE_ARQUIVO_BYTES, validarArquivoCardapio } from './arquivo-cardapio'

const bytes = (...b: number[]) => Uint8Array.from([...b, ...new Array(20).fill(0)])
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))

describe('validarArquivoCardapio', () => {
  it('reconhece PDF, JPEG, PNG e WebP pelos primeiros bytes', () => {
    expect(validarArquivoCardapio(bytes(...ascii('%PDF-1.7')))).toMatchObject({ ok: true, mime: 'application/pdf', ext: 'pdf' })
    expect(validarArquivoCardapio(bytes(0xff, 0xd8, 0xff, 0xe0))).toMatchObject({ ok: true, mime: 'image/jpeg', ext: 'jpg' })
    expect(validarArquivoCardapio(bytes(0x89, 0x50, 0x4e, 0x47))).toMatchObject({ ok: true, mime: 'image/png', ext: 'png' })
    expect(validarArquivoCardapio(bytes(...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WEBP')))).toMatchObject({ ok: true, mime: 'image/webp', ext: 'webp' })
  })
  it('recusa arquivo falso, RIFF que não é WebP, vazio e grande', () => {
    expect(validarArquivoCardapio(bytes(...ascii('MZ\u0090')))).toEqual({ ok: false, erro: 'Envie um PDF ou uma imagem (JPEG, PNG ou WebP).' })
    expect(validarArquivoCardapio(bytes(...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WAVE'))).ok).toBe(false)
    expect(validarArquivoCardapio(new Uint8Array(0)).ok).toBe(false)
    expect(validarArquivoCardapio(bytes(...ascii('%PDF')), LIMITE_ARQUIVO_BYTES + 1)).toEqual({ ok: false, erro: 'O arquivo passa de 20 MB. Envie um PDF menor ou uma foto.' })
    expect(validarArquivoCardapio(bytes(...ascii('%PDF')), LIMITE_ARQUIVO_BYTES).ok).toBe(true)
  })
})

describe('limite configurável (NEXT_PUBLIC_LIMITE_UPLOAD_MB)', () => {
  const carregar = async (v?: string) => {
    vi.resetModules()
    vi.unstubAllEnvs()
    if (v !== undefined) vi.stubEnv('NEXT_PUBLIC_LIMITE_UPLOAD_MB', v)
    return import('./arquivo-cardapio')
  }
  afterEach(() => vi.unstubAllEnvs())

  it('padrão é 20 MB', async () => {
    const m = await carregar()
    expect(m.LIMITE_ARQUIVO_MB).toBe(20)
    expect(m.MENSAGEM_LIMITE).toBe('O arquivo passa de 20 MB. Envie um PDF menor ou uma foto.')
  })
  it('com 4 vale 4 MB e a mensagem cita 4 MB', async () => {
    const m = await carregar('4')
    expect(m.LIMITE_ARQUIVO_BYTES).toBe(4 * 1024 * 1024)
    expect(m.MENSAGEM_LIMITE).toContain('4 MB')
    expect(m.validarArquivoCardapio(bytes(...ascii('%PDF')), 4 * 1024 * 1024 + 1)).toEqual({ ok: false, erro: m.MENSAGEM_LIMITE })
  })
  it.each(['0', '25', 'abc', '2.5', '-1'])('valor inválido %s cai no padrão 20', async (v) => {
    expect((await carregar(v)).LIMITE_ARQUIVO_MB).toBe(20)
  })
})
