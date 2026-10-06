import 'server-only'
import { listarCardapio, type JwtClaims } from '@atd/db'
import { arquivoDaMensagem, type MensagemTela } from '@/lib/simulador-tela'
import { createClient } from '@/lib/supabase/server'
import { getDb } from './db.ts'

/** URL assinada curta: a página é recarregada a cada mudança da conversa. */
const MIDIA_SEGUNDOS = 600

/**
 * Título e URL assinada dos arquivos do cardápio citados nas mensagens (como no simulador): só arquivos que a RLS deixa
 * o usuário ver, com o cliente Supabase do próprio usuário (policies do Storage).
 */
export async function midiasDasMensagens(
  claims: JwtClaims,
  mensagens: readonly Pick<MensagemTela, 'direcao' | 'tipo' | 'payload'>[],
): Promise<Map<string, { titulo: string; url: string | null }>> {
  const ids = new Set(mensagens.map(arquivoDaMensagem).filter((id): id is string => id !== null))
  const out = new Map<string, { titulo: string; url: string | null }>()
  if (ids.size === 0) return out
  const { arquivos } = await listarCardapio(getDb(), claims)
  const supabase = await createClient()
  for (const a of arquivos.filter((x) => ids.has(x.id))) {
    const [bucket, ...resto] = a.storagePath.split('/')
    const { data, error } = bucket
      ? await supabase.storage.from(bucket).createSignedUrl(resto.join('/'), MIDIA_SEGUNDOS)
      : { data: null, error: true }
    out.set(a.id, { titulo: a.titulo, url: error || !data ? null : data.signedUrl })
  }
  return out
}
