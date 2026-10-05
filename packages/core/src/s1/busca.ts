import { normalizeText } from '../normalize.ts'

export const LIMIAR_UNIDADE = 0.4
export const LIMIAR_FATO = 0.45
const EMPATE = 0.05

/** Trigramas no estilo do pg_trgm: cada palavra com dois espaços antes e um depois. */
export function trigramas(s: string): Set<string> {
  const out = new Set<string>()
  for (const w of normalizeText(s).split(' ').filter(Boolean)) {
    const p = `  ${w} `
    for (let i = 0; i + 3 <= p.length; i++) out.add(p.slice(i, i + 3))
  }
  return out
}

export function similaridade(a: string, b: string): number {
  const A = trigramas(a)
  const B = trigramas(b)
  if (A.size === 0 || B.size === 0) return 0
  let comum = 0
  for (const t of A) if (B.has(t)) comum++
  return comum / (A.size + B.size - comum)
}

const PREFIXOS = /^((a|o|na|no|da|do|de|em|unidade|loja|restaurante|filial)\s+)+/
const limpar = (s: string) => normalizeText(s).replace(PREFIXOS, '').trim()
/** `alvo` aparece em `texto` como palavras inteiras */
const contem = (texto: string, alvo: string) => alvo !== '' && ` ${texto} `.includes(` ${alvo} `)

/** distância de edição (Levenshtein) entre duas palavras */
function distancia(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]!
}

/** toda palavra (≥ 3 letras) do texto está a no máximo 1 edição de alguma palavra do nome */
function palavrasProximas(texto: string, nome: string): boolean {
  const doNome = nome.split(' ')
  return texto.split(' ').filter((w) => w.length >= 3).every((w) => doNome.some((p) => distancia(w, p) <= 1))
}

const PALAVRAS_GENERICAS = new Set(['tem', 'pode', 'qual', 'quais', 'como', 'onde', 'voces', 'vcs', 'para', 'pra', 'com', 'uma', 'um', 'que', 'aqui', 'ai', 'ter', 'ha', 'sim', 'nao'])

function pontuar(texto: string, rotulo: string): number {
  if (contem(texto, rotulo)) return 1
  if (texto.length >= 3 && !PALAVRAS_GENERICAS.has(texto) && contem(rotulo, texto)) return 1
  return similaridade(texto, rotulo)
}

export function encontrarUnidade<U extends { id: string; nome: string; apelidos: readonly string[] }>(
  texto: string | null,
  unidades: readonly U[],
): U | null {
  if (!texto) return null
  const t = limpar(texto)
  if (!t) return null
  const nomes = (u: U) => [u.nome, ...u.apelidos].map(limpar).filter(Boolean)
  // "asa" está dentro de "asa sul" e de "asa norte": ambíguo
  if (unidades.filter((u) => nomes(u).some((n) => contem(n, t) && n !== t)).length >= 2) return null
  const ranking = unidades
    .map((u) => ({ u, s: Math.max(...nomes(u).map((n) => (contem(t, n) ? 1 : t.includes(' ') && !palavrasProximas(t, n) ? 0 : similaridade(t, n)))) }))
    .sort((a, b) => b.s - a.s)
  const [p, q] = ranking
  if (!p || p.s < LIMIAR_UNIDADE) return null
  if (q && p.s - q.s < EMPATE) return null
  return p.u
}

export function encontrarFato<F extends { id: string; tema: string; exemplos: readonly string[]; unitId: string | null }>(
  tema: string | null,
  fatos: readonly F[],
  unitId: string | null,
): F | null {
  if (!tema) return null
  const t = normalizeText(tema)
  if (!t) return null
  const candidatos = unitId ? fatos.filter((f) => f.unitId === null || f.unitId === unitId) : fatos
  let melhor: { f: F; s: number } | null = null
  for (const f of candidatos) {
    const s = Math.max(...[f.tema, ...f.exemplos].map((r) => pontuar(t, normalizeText(r))))
    const prefere = unitId ? f.unitId === unitId : f.unitId === null
    if (!melhor || s > melhor.s || (s === melhor.s && prefere)) melhor = { f, s }
  }
  return melhor && melhor.s >= LIMIAR_FATO ? melhor.f : null
}

export function chaveLacuna(tipo: 'info' | 'horario' | 'endereco' | 'unidades', tema?: string | null): string {
  if (tipo !== 'info') return tipo
  return `info:${normalizeText(tema ?? '').slice(0, 60) || 'geral'}`
}
