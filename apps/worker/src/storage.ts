/** Teto do objeto lido do Storage (o mesmo dos buckets `cardapio` e `importacoes`). */
export const MAX_OBJETO_BYTES = 20 * 1024 * 1024
const TIMEOUT_MS = 20_000
const BUCKET = /^[a-z0-9_-]+$/

/**
 * Leitura de objetos dos buckets privados por REST com a chave de serviço (só no worker; nunca em log).
 * Sem dependência nova: `GET {SUPABASE_URL}/storage/v1/object/{bucket}/{caminho}`.
 */
export function createStorage(cfg: { url: string; serviceRoleKey: string; fetch?: typeof fetch }) {
  const doFetch = cfg.fetch ?? fetch
  const base = cfg.url.replace(/\/+$/, '')
  return {
    async baixarObjeto(bucket: string, caminho: string): Promise<Uint8Array> {
      const partes = caminho.split('/')
      if (!BUCKET.test(bucket) || partes.some((p) => !p || p === '.' || p === '..')) throw new Error('caminho de Storage inválido')
      const url = `${base}/storage/v1/object/${bucket}/${partes.map(encodeURIComponent).join('/')}`
      const res = await doFetch(url, {
        headers: { Authorization: `Bearer ${cfg.serviceRoleKey}`, apikey: cfg.serviceRoleKey },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined)
        throw new Error(`Storage respondeu HTTP ${res.status}`)
      }
      const declarado = Number(res.headers.get('content-length') ?? '0')
      if (declarado > MAX_OBJETO_BYTES) {
        await res.body?.cancel().catch(() => undefined)
        throw new Error('objeto acima de 20 MB')
      }
      if (!res.body) return new Uint8Array(0)
      // conta o corpo de verdade (o cabeçalho pode faltar ou mentir)
      const pedacos: Uint8Array[] = []
      let total = 0
      const leitor = res.body.getReader()
      for (;;) {
        const { done, value } = await leitor.read()
        if (done) break
        total += value.byteLength
        if (total > MAX_OBJETO_BYTES) {
          await leitor.cancel().catch(() => undefined)
          throw new Error('objeto acima de 20 MB')
        }
        pedacos.push(value)
      }
      const out = new Uint8Array(total)
      let pos = 0
      for (const p of pedacos) {
        out.set(p, pos)
        pos += p.byteLength
      }
      return out
    },
  }
}

export type Storage = ReturnType<typeof createStorage>

const comeca = (b: Uint8Array, sig: readonly number[], desde = 0) => b.length >= desde + sig.length && sig.every((x, i) => b[desde + i] === x)
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))

/** Tipo do arquivo pelos primeiros bytes (mesmas assinaturas do upload do painel); null se não for PDF/JPEG/PNG/WebP. */
export function mimeDosBytes(bytes: Uint8Array): 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (comeca(bytes, ascii('%PDF'))) return 'application/pdf'
  if (comeca(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (comeca(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'image/png'
  if (comeca(bytes, ascii('RIFF')) && comeca(bytes, ascii('WEBP'), 8)) return 'image/webp'
  return null
}
