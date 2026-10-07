/**
 * Logo do restaurante (spec §7): PNG, JPG ou WebP até 1 MB, sem SVG. O tipo vem dos primeiros bytes, nunca do nome
 * nem do MIME declarado. O bucket `marca` é público para leitura (logo não é dado pessoal).
 */
export const LIMITE_LOGO_BYTES = 1024 * 1024
export const ACEITA_LOGO = 'image/png,image/jpeg,image/webp'
export const ERRO_TIPO_LOGO = 'Envie a logo em PNG, JPG ou WebP (SVG não é aceito).'
export const ERRO_TAMANHO_LOGO = 'A logo passa de 1 MB. Envie uma imagem menor.'

export type ImagemLogo = { ok: true; mime: 'image/png' | 'image/jpeg' | 'image/webp'; ext: 'png' | 'jpg' | 'webp' }

const comeca = (b: Uint8Array, sig: number[], desde = 0) => sig.every((x, i) => b[desde + i] === x)
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))
const ASSINATURA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export function validarImagemLogo(bytes: Uint8Array, tamanho: number = bytes.length): ImagemLogo | { ok: false; erro: string } {
  if (tamanho > LIMITE_LOGO_BYTES || bytes.length > LIMITE_LOGO_BYTES) return { ok: false, erro: ERRO_TAMANHO_LOGO }
  if (tamanho === 0 || bytes.length === 0) return { ok: false, erro: 'O arquivo está vazio.' }
  if (comeca(bytes, ASSINATURA_PNG)) return { ok: true, mime: 'image/png', ext: 'png' }
  if (comeca(bytes, [0xff, 0xd8, 0xff])) return { ok: true, mime: 'image/jpeg', ext: 'jpg' }
  if (comeca(bytes, ascii('RIFF')) && comeca(bytes, ascii('WEBP'), 8)) return { ok: true, mime: 'image/webp', ext: 'webp' }
  return { ok: false, erro: ERRO_TIPO_LOGO }
}

/** URL pública do objeto no bucket `marca` (`<restaurant_id>/logo-<sha256>.<ext>`). */
export function urlPublicaLogo(logoPath: string | null): string | null {
  if (!logoPath) return null
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '')
  return `${base}/storage/v1/object/public/marca/${logoPath}`
}
