import 'server-only'
import { createHash } from 'node:crypto'
import { LIMITE_ARQUIVO_BYTES, MENSAGEM_LIMITE, validarArquivoCardapio } from '@/lib/arquivo-cardapio'
import { LIMITE_LOGO_BYTES, ERRO_TAMANHO_LOGO, validarImagemLogo } from '@/lib/logo'
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
  if (arquivo.size > LIMITE_ARQUIVO_BYTES) return { ok: false, erro: MENSAGEM_LIMITE }
  const bytes = new Uint8Array(await arquivo.arrayBuffer())
  const v = validarArquivoCardapio(bytes)
  if (!v.ok) return v
  return { ok: true, bytes, mime: v.mime, ext: v.ext, sha256: sha256(bytes) }
}

/** Logo do restaurante: PNG, JPG ou WebP até 1 MB, conferida pelos bytes (`validarImagemLogo`). */
export async function lerImagemLogo(arquivo: File): Promise<ArquivoRecebido> {
  if (arquivo.size > LIMITE_LOGO_BYTES) return { ok: false, erro: ERRO_TAMANHO_LOGO }
  const bytes = new Uint8Array(await arquivo.arrayBuffer())
  const v = validarImagemLogo(bytes)
  if (!v.ok) return v
  return { ok: true, bytes, mime: v.mime, ext: v.ext, sha256: sha256(bytes) }
}

const jaExiste = (e: { statusCode?: string | number; message?: string }) => String(e.statusCode) === '409' || /already exists/i.test(e.message ?? '')

/**
 * Grava em `<bucket>/<restaurant_id>/<prefixo><sha256>.<ext>` e devolve esse caminho (o mesmo conteúdo já gravado é
 * aceito). A logo usa o prefixo `logo-`.
 */
export async function subirArquivo(
  bucket: 'cardapio' | 'importacoes' | 'marca',
  restaurantId: string,
  a: { bytes: Uint8Array; mime: string; ext: string; sha256: string },
  prefixo = '',
): Promise<{ ok: true; storagePath: string; criado: boolean } | { ok: false }> {
  const objeto = `${restaurantId}/${prefixo}${a.sha256}.${a.ext}`
  const supabase = await createClient()
  const { error } = await supabase.storage.from(bucket).upload(objeto, a.bytes, { contentType: a.mime, upsert: false })
  if (error && !jaExiste(error as { statusCode?: string; message?: string })) return { ok: false }
  // `criado: false` = o mesmo conteúdo já estava gravado (pode estar em uso; quem chama não deve apagá-lo)
  return { ok: true, storagePath: `${bucket}/${objeto}`, criado: !error }
}

/**
 * Copia um objeto do bucket `importacoes` para `cardapio` (mesmo `<restaurant_id>/<arquivo>`), com a sessão do
 * usuário (lê importacoes e grava em cardapio: dono/gerente). Destino já existente é aceito (nome = sha256).
 */
export async function copiarParaCardapio(storagePath: string): Promise<boolean> {
  const objeto = storagePath.replace(/^importacoes\//, '')
  if (objeto === storagePath) return false
  const supabase = await createClient()
  const { error } = await supabase.storage.from('importacoes').copy(objeto, objeto, { destinationBucket: 'cardapio' })
  return !error || jaExiste(error as { statusCode?: string; message?: string })
}

/** Apaga um objeto do bucket `marca` com a sessão do usuário (policies de dono/gerente). Falha não lança: devolve false. */
export async function apagarDaMarca(objeto: string): Promise<boolean> {
  try {
    const supabase = await createClient()
    const { error } = await supabase.storage.from('marca').remove([objeto])
    return !error
  } catch {
    return false
  }
}
