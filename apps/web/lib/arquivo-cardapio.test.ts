import { describe, expect, it } from 'vitest'
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
    expect(validarArquivoCardapio(bytes(...ascii('%PDF')), LIMITE_ARQUIVO_BYTES + 1)).toEqual({ ok: false, erro: 'O arquivo passa de 20 MB. Envie um menor.' })
    expect(validarArquivoCardapio(bytes(...ascii('%PDF')), LIMITE_ARQUIVO_BYTES).ok).toBe(true)
  })
})
