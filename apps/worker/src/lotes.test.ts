import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { contarPaginas, dividirLote, IMAGENS_POR_LOTE, montarLote, PAGINAS_POR_LOTE, planejarLotes } from './lotes.ts'

async function pdfDePaginas(n: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < n; i++) doc.addPage([100 + i, 100])
  return doc.save()
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
const img = (ordem: number) => ({ ordem, mime: 'image/png', paginas: null })
const pdf = (ordem: number, paginas: number) => ({ ordem, mime: 'application/pdf', paginas })

describe('planejarLotes', () => {
  it('PDF de 12 páginas = 3 lotes de até 5 páginas, em ordem', () => {
    expect(PAGINAS_POR_LOTE).toBe(5)
    expect(planejarLotes([pdf(1, 12)])).toEqual([
      { partes: [{ ordem: 1, mime: 'application/pdf', paginas: { de: 0, ate: 5 } }] },
      { partes: [{ ordem: 1, mime: 'application/pdf', paginas: { de: 5, ate: 10 } }] },
      { partes: [{ ordem: 1, mime: 'application/pdf', paginas: { de: 10, ate: 12 } }] },
    ])
  })

  it('7 imagens = 3 lotes (3 + 3 + 1), na ordem dos arquivos', () => {
    expect(IMAGENS_POR_LOTE).toBe(3)
    const lotes = planejarLotes([1, 2, 3, 4, 5, 6, 7].map(img))
    expect(lotes.map((l) => l.partes.map((p) => p.ordem))).toEqual([[1, 2, 3], [4, 5, 6], [7]])
  })

  it('arquivos misturados: imagens seguidas se agrupam; o PDF nunca divide lote com imagem; a ordem é preservada', () => {
    const lotes = planejarLotes([img(1), img(2), pdf(3, 6), img(4), pdf(5, 1)])
    expect(lotes.map((l) => l.partes.map((p) => [p.ordem, p.paginas ?? null]))).toEqual([
      [[1, null], [2, null]],
      [[3, { de: 0, ate: 5 }]],
      [[3, { de: 5, ate: 6 }]],
      [[4, null]],
      [[5, { de: 0, ate: 1 }]],
    ])
  })

  it('PDF sem contagem de páginas lança (o planejamento exige a contagem)', () => {
    expect(() => planejarLotes([{ ordem: 1, mime: 'application/pdf', paginas: null }])).toThrow()
  })
})

describe('dividirLote', () => {
  it('lote de PDF com várias páginas vira duas metades; a primeira fica com a página do meio', () => {
    expect(dividirLote({ partes: [{ ordem: 2, mime: 'application/pdf', paginas: { de: 5, ate: 10 } }] })).toEqual([
      { partes: [{ ordem: 2, mime: 'application/pdf', paginas: { de: 5, ate: 8 } }] },
      { partes: [{ ordem: 2, mime: 'application/pdf', paginas: { de: 8, ate: 10 } }] },
    ])
  })

  it('grupo de imagens vira duas metades; página ou imagem única não se divide', () => {
    expect(dividirLote({ partes: [img(1), img(2), img(3)] })?.map((l) => l.partes.map((p) => p.ordem))).toEqual([[1, 2], [3]])
    expect(dividirLote({ partes: [img(1)] })).toBeNull()
    expect(dividirLote({ partes: [{ ordem: 1, mime: 'application/pdf', paginas: { de: 3, ate: 4 } }] })).toBeNull()
  })
})

describe('contarPaginas e montarLote', () => {
  it('conta as páginas do PDF; bytes que não são PDF lançam', async () => {
    expect(await contarPaginas(await pdfDePaginas(12))).toBe(12)
    await expect(contarPaginas(new TextEncoder().encode('%PDF-1.7 lixo'))).rejects.toThrow()
  })

  it('PDF: copia só as páginas do lote para um PDF novo (em memória), na ordem', async () => {
    const bytes = await pdfDePaginas(12)
    const partes = await montarLote(
      { partes: [{ ordem: 1, mime: 'application/pdf', paginas: { de: 5, ate: 10 } }] },
      new Map([[1, bytes]]),
    )
    expect(partes).toHaveLength(1)
    const p = partes[0]!
    expect(p.type).toBe('pdf')
    if (p.type !== 'pdf') return
    expect(p.filename).toBe('documento-1-paginas-6-a-10.pdf')
    const novo = await PDFDocument.load(Buffer.from(p.base64, 'base64'))
    expect(novo.getPageCount()).toBe(5)
    // larguras 105..109 = páginas 6..10 do original
    expect(novo.getPages().map((pg) => pg.getWidth())).toEqual([105, 106, 107, 108, 109])
  })

  it('PDF inteiro num lote vai com os bytes originais; imagens vão como partes de imagem', async () => {
    const bytes = await pdfDePaginas(2)
    const [p] = await montarLote({ partes: [{ ordem: 1, mime: 'application/pdf', paginas: { de: 0, ate: 2 } }] }, new Map([[1, bytes]]))
    expect(p).toEqual({ type: 'pdf', filename: 'documento-1.pdf', base64: Buffer.from(bytes).toString('base64') })
    const imgs = await montarLote({ partes: [img(1), img(2)] }, new Map([[1, PNG], [2, PNG]]))
    expect(imgs).toEqual([
      { type: 'image', mime: 'image/png', base64: Buffer.from(PNG).toString('base64') },
      { type: 'image', mime: 'image/png', base64: Buffer.from(PNG).toString('base64') },
    ])
  })

  it('arquivo do lote sem bytes baixados lança', async () => {
    await expect(montarLote({ partes: [img(1)] }, new Map())).rejects.toThrow()
  })
})
