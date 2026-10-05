import { ehHostGoogleMaps, ehLinkCurtoMaps, extrairCoordenadas, type Coordenadas } from '@atd/core'

const MAX_SALTOS = 3
const TIMEOUT_MS = 5_000

function portaNaoPadrao(url: string): boolean {
  try {
    return new URL(url).port !== ''
  } catch {
    return true
  }
}

/**
 * Coordenadas de um link do Google Maps. Link curto (maps.app.goo.gl) é seguido só por
 * redirecionamentos para hosts do Google Maps, sem baixar páginas.
 */
export async function coordenadasDoLink(link: string, f: typeof fetch = fetch): Promise<Coordenadas | null> {
  let atual = link.trim()
  for (let i = 0; ehLinkCurtoMaps(atual); i++) {
    if (i >= MAX_SALTOS || portaNaoPadrao(atual)) return null
    let destino: string | null
    try {
      const res = await f(atual, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) })
      destino = res.headers.get('location')
      await res.body?.cancel()
    } catch {
      return null
    }
    if (!destino) return null
    let proximo: URL
    try {
      proximo = new URL(destino, atual)
    } catch {
      return null
    }
    if (proximo.protocol !== 'https:' || proximo.port !== '' || !ehHostGoogleMaps(proximo.hostname)) return null
    atual = proximo.toString()
  }
  return extrairCoordenadas(atual)
}
