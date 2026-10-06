/** Validação de arquivo de cardápio no servidor: o tipo vem dos primeiros bytes, nunca do nome nem do MIME declarado. */
// Lido como `process.env.NEXT_PUBLIC_*` literal para o Next embutir o valor no bundle do cliente.
const mb = Number(process.env.NEXT_PUBLIC_LIMITE_UPLOAD_MB ?? 20)
export const LIMITE_ARQUIVO_MB = Number.isInteger(mb) && mb >= 1 && mb <= 20 ? mb : 20
export const LIMITE_ARQUIVO_BYTES = LIMITE_ARQUIVO_MB * 1024 * 1024
export const MENSAGEM_LIMITE = `O arquivo passa de ${LIMITE_ARQUIVO_MB} MB. Envie um PDF menor ou uma foto.`

export type ArquivoValido = { ok: true; mime: string; ext: string }
export type ArquivoInvalido = { ok: false; erro: string }

const ERRO_TIPO = 'Envie um PDF ou uma imagem (JPEG, PNG ou WebP).'

const comeca = (b: Uint8Array, sig: number[], desde = 0) => sig.every((x, i) => b[desde + i] === x)
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))

export function validarArquivoCardapio(bytes: Uint8Array, tamanho: number = bytes.length): ArquivoValido | ArquivoInvalido {
  if (tamanho > LIMITE_ARQUIVO_BYTES) return { ok: false, erro: MENSAGEM_LIMITE }
  if (tamanho === 0 || bytes.length === 0) return { ok: false, erro: 'O arquivo está vazio.' }
  if (comeca(bytes, ascii('%PDF'))) return { ok: true, mime: 'application/pdf', ext: 'pdf' }
  if (comeca(bytes, [0xff, 0xd8, 0xff])) return { ok: true, mime: 'image/jpeg', ext: 'jpg' }
  if (comeca(bytes, [0x89, 0x50, 0x4e, 0x47])) return { ok: true, mime: 'image/png', ext: 'png' }
  if (comeca(bytes, ascii('RIFF')) && comeca(bytes, ascii('WEBP'), 8)) return { ok: true, mime: 'image/webp', ext: 'webp' }
  return { ok: false, erro: ERRO_TIPO }
}
