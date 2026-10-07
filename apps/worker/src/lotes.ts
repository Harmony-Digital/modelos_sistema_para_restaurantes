import { EncryptedPDFError, PDFDocument } from 'pdf-lib'
import type { ConteudoUsuario } from '@atd/ai'

/** Páginas de PDF por lote (spec Etapa 07 §3): uma chamada ao modelo por lote. */
export const PAGINAS_POR_LOTE = 5
/** Imagens por lote. */
export const IMAGENS_POR_LOTE = 3

const PDF = 'application/pdf'

export type ArquivoParaLote = { ordem: number; mime: string; paginas: number | null }
/** Parte de um lote: uma imagem inteira, ou as páginas `[de, ate)` (base 0) de um PDF. */
export type ParteLote = { ordem: number; mime: string; paginas?: { de: number; ate: number } | null }
export type Lote = { partes: ParteLote[] }

/**
 * Lotes na ordem dos arquivos e das páginas: cada PDF em blocos de até 5 páginas (nunca junto com imagem nem com
 * outro PDF); imagens seguidas em grupos de até 3. PDF sem `paginas` lança (o worker conta antes de planejar).
 */
export function planejarLotes(arquivos: readonly ArquivoParaLote[]): Lote[] {
  const lotes: Lote[] = []
  let imagens: ParteLote[] = []
  const fecharImagens = () => {
    if (imagens.length) lotes.push({ partes: imagens })
    imagens = []
  }
  for (const a of arquivos) {
    if (a.mime === PDF) {
      fecharImagens()
      if (a.paginas === null || a.paginas < 1) throw new Error('PDF sem contagem de páginas')
      for (let de = 0; de < a.paginas; de += PAGINAS_POR_LOTE) {
        lotes.push({ partes: [{ ordem: a.ordem, mime: a.mime, paginas: { de, ate: Math.min(de + PAGINAS_POR_LOTE, a.paginas) } }] })
      }
    } else {
      imagens.push({ ordem: a.ordem, mime: a.mime })
      if (imagens.length === IMAGENS_POR_LOTE) fecharImagens()
    }
  }
  fecharImagens()
  return lotes
}

/**
 * Metades de um lote cuja leitura saiu cortada: páginas do PDF ou grupo de imagens divididos ao meio (a primeira
 * metade fica com o elemento do meio). Página ou imagem única ⇒ null (não há como dividir).
 */
export function dividirLote(lote: Lote): [Lote, Lote] | null {
  const [unica] = lote.partes
  if (lote.partes.length === 1 && unica?.paginas) {
    const { de, ate } = unica.paginas
    if (ate - de < 2) return null
    const meio = de + Math.ceil((ate - de) / 2)
    return [
      { partes: [{ ...unica, paginas: { de, ate: meio } }] },
      { partes: [{ ...unica, paginas: { de: meio, ate } }] },
    ]
  }
  if (lote.partes.length < 2) return null
  const meio = Math.ceil(lote.partes.length / 2)
  return [{ partes: lote.partes.slice(0, meio) }, { partes: lote.partes.slice(meio) }]
}

/** O erro de `contarPaginas`/`montarLote` é de PDF protegido por senha (cifrado). */
export const pdfProtegido = (err: unknown) =>
  err instanceof EncryptedPDFError || (err instanceof Error && /is encrypted/.test(err.message))

/** Total de páginas do PDF (pdf-lib). PDF inválido ou cifrado lança. */
export async function contarPaginas(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  return doc.getPageCount()
}

const base64 = (b: Uint8Array) => Buffer.from(b).toString('base64')

/**
 * Partes da chamada ao modelo para o lote: imagens como estão; páginas de PDF copiadas para um PDF novo em memória
 * (o PDF inteiro vai com os bytes originais). O nome do PDF não carrega nada do documento.
 */
export async function montarLote(lote: Lote, bytesPorOrdem: ReadonlyMap<number, Uint8Array>): Promise<ConteudoUsuario[]> {
  const partes: ConteudoUsuario[] = []
  for (const p of lote.partes) {
    const bytes = bytesPorOrdem.get(p.ordem)
    if (!bytes) throw new Error(`arquivo ${p.ordem} do lote não foi baixado`)
    if (!p.paginas) {
      partes.push({ type: 'image', mime: p.mime, base64: base64(bytes) })
      continue
    }
    const { de, ate } = p.paginas
    const origem = await PDFDocument.load(bytes, { updateMetadata: false })
    const total = origem.getPageCount()
    if (ate > total || de < 0 || de >= ate) throw new Error('páginas do lote fora do PDF')
    if (de === 0 && ate === total) {
      partes.push({ type: 'pdf', filename: `documento-${p.ordem}.pdf`, base64: base64(bytes) })
      continue
    }
    const novo = await PDFDocument.create()
    const indices = Array.from({ length: ate - de }, (_, i) => de + i)
    for (const pagina of await novo.copyPages(origem, indices)) novo.addPage(pagina)
    partes.push({ type: 'pdf', filename: `documento-${p.ordem}-paginas-${de + 1}-a-${ate}.pdf`, base64: base64(await novo.save()) })
  }
  return partes
}
