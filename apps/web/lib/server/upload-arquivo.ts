import 'server-only'
import { createHash } from 'node:crypto'
import { LIMITE_ARQUIVO_BYTES, validarArquivoCardapio } from '@/lib/arquivo-cardapio'
import { createClient } from '@/lib/supabase/server'

/**
 * Upload de PDF/imagem pelo painel (cardápio e importação). Tipo, tamanho e sha256 são conferidos aqui — nunca no
 * navegador — e o objeto vai ao Storage com a sessão do próprio usuário (policies por papel). O nome é o sha256:
 * mesmo conteúdo, mesmo objeto. Só para Server Actions (usa o cliente Supabase do servidor).
 */
export type ArquivoRecebido = { ok: true; bytes: Uint8Array; mime: string; ext: string; sha256: string } | { ok: false; erro: string }

export const ERRO_SEM_ARQUIVO = 'Escolha o arquivo do cardápio.'
export const ERRO_STORAGE = 'Não foi possível enviar o arquivo agora. Tente de novo.'

export const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

/** `null` = o campo veio vazio ou não é arquivo. */
export function arquivoDoForm(valor: FormDataEntryValue | null): File | null {
  return valor instanceof File && !(valor.size === 0 && valor.name === '') ? valor : null
}

/** Confere o tamanho declarado antes de ler o corpo; depois, os primeiros bytes. */
export async function lerArquivoCardapio(arquivo: File): Promise<ArquivoRecebido> {
  if (arquivo.size > LIMITE_ARQUIVO_BYTES) return { ok: false, erro: 'O arquivo passa de 20 MB. Envie um menor.' }
  const bytes = new Uint8Array(await arquivo.arrayBuffer())
  const v = validarArquivoCardapio(bytes)
  if (!v.ok) return v
  return { ok: true, bytes, mime: v.mime, ext: v.ext, sha256: sha256(bytes) }
}

const jaExiste = (e: { statusCode?: string | number; message?: string }) => String(e.statusCode) === '409' || /already exists/i.test(e.message ?? '')

/** Grava em `<bucket>/<restaurant_id>/<sha256>.<ext>` e devolve esse caminho (o mesmo conteúdo já gravado é aceito). */
export async function subirArquivo(
  bucket: 'cardapio' | 'importacoes',
  restaurantId: string,
  a: { bytes: Uint8Array; mime: string; ext: string; sha256: string },
): Promise<{ ok: true; storagePath: string } | { ok: false }> {
  const objeto = `${restaurantId}/${a.sha256}.${a.ext}`
  const supabase = await createClient()
  const { error } = await supabase.storage.from(bucket).upload(objeto, a.bytes, { contentType: a.mime, upsert: false })
  if (error && !jaExiste(error as { statusCode?: string; message?: string })) return { ok: false }
  return { ok: true, storagePath: `${bucket}/${objeto}` }
}
