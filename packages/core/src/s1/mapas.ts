export type Coordenadas = { lat: number; lng: number }

const HOSTS_GOOGLE = new Set(['google.com', 'www.google.com', 'google.com.br', 'www.google.com.br'])
const HOSTS_MAPS = new Set(['maps.google.com', 'maps.google.com.br'])

function lerUrl(link: string): URL | null {
  try {
    return new URL(link.trim())
  } catch {
    return null
  }
}

export function ehHostGoogleMaps(host: string): boolean {
  return HOSTS_GOOGLE.has(host) || HOSTS_MAPS.has(host) || host === 'maps.app.goo.gl' || host === 'goo.gl'
}

export function ehLinkCurtoMaps(link: string): boolean {
  const u = lerUrl(link)
  if (!u || u.protocol !== 'https:') return false
  return u.hostname === 'maps.app.goo.gl' || (u.hostname === 'goo.gl' && u.pathname.startsWith('/maps'))
}

export function ehLinkGoogleMaps(link: string): boolean {
  if (ehLinkCurtoMaps(link)) return true
  const u = lerUrl(link)
  if (!u || u.protocol !== 'https:') return false
  return HOSTS_MAPS.has(u.hostname) || (HOSTS_GOOGLE.has(u.hostname) && u.pathname.startsWith('/maps'))
}

const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)'
const PINO = new RegExp(`!3d${NUM}!4d${NUM}`)
const ARROBA = new RegExp(`@${NUM},${NUM}`)
const PAR = new RegExp(`^\\s*${NUM}\\s*,\\s*${NUM}\\s*$`)
const PARAMETROS = ['q', 'query', 'll', 'center', 'destination']
const seis = (n: number) => Math.round(n * 1e6) / 1e6

/** Coordenadas de um link completo do Google Maps (sem rede). Link curto: resolver antes no servidor. */
export function extrairCoordenadas(link: string): Coordenadas | null {
  if (!ehLinkGoogleMaps(link) || ehLinkCurtoMaps(link)) return null
  const u = lerUrl(link)!
  let caminho = u.pathname
  try {
    caminho = decodeURIComponent(u.pathname)
  } catch {
    // caminho com % inválido: usa como veio
  }
  let par = PINO.exec(caminho) ?? ARROBA.exec(caminho)
  if (!par) {
    for (const k of PARAMETROS) {
      const v = u.searchParams.get(k)
      const m = v ? PAR.exec(v) : null
      if (m) {
        par = m
        break
      }
    }
  }
  if (!par) return null
  const lat = Number(par[1])
  const lng = Number(par[2])
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { lat: seis(lat), lng: seis(lng) }
}
