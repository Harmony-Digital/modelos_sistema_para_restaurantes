import { normalizeText } from '../normalize.ts'

export const MIN_PESSOAS = 1
export const MAX_PESSOAS = 60

// por extenso até "vinte" (spec §2.2); "um"/"uma" à parte: quase sempre é artigo
const POR_EXTENSO: Readonly<Record<string, number>> = {
  dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17,
  dezoito: 18, dezenove: 19, vinte: 20,
}
const UM = new Set(['um', 'uma'])
const DUVIDA = /\b(ou|talvez|sei|entre|ate)\b/
const SOZINHO = /^(?:(?:vou|vai|sou|so|somente|apenas)\s+)*(?:eu|eu mesmo|eu mesma|sozinho|sozinha)(?:\s+mesmo|\s+mesma)?$/
const ACOMPANHANTE_SINGULAR = new Set(['meu', 'minha', 'o', 'a', 'um', 'uma', 'ele', 'ela'])

const valor = (token: string): number | null =>
  /^\d{1,3}$/.test(token) ? Number(token) : (POR_EXTENSO[token] ?? (UM.has(token) ? 1 : null))

const noIntervalo = (n: number | null) => (n !== null && Number.isInteger(n) && n >= MIN_PESSOAS && n <= MAX_PESSOAS ? n : null)

/**
 * Lê a quantidade de pessoas de uma resposta curta ("4", "somos 5", "quatro", "eu e minha esposa").
 * Ambíguo ou fora de 1–60 ⇒ null (nunca chuta).
 */
export function lerPessoas(texto: string): number | null {
  const t = normalizeText(texto)
  if (!t || DUVIDA.test(t)) return null
  if (SOZINHO.test(t)) return 1

  const mais = /\beu e mais (\S+)$/.exec(t)
  if (mais) {
    const n = valor(mais[1]!)
    return n === null ? null : noIntervalo(n + 1)
  }

  const tokens = t.split(' ')
  const numeros = tokens.filter((w) => !UM.has(w)).map(valor).filter((n): n is number => n !== null)
  if (numeros.length > 1) return null
  if (numeros.length === 1) return noIntervalo(numeros[0]!)

  if (/\bcasal\b/.test(t)) return 2
  const eu = /\beu\b(.*)$/.exec(t)
  if (eu) {
    // "eu e minha esposa", "eu, meu marido e minha filha": 1 + um por acompanhante no singular
    const partes = eu[1]!.split(/\b(?:e|com)\b/).map((p) => p.trim()).filter(Boolean)
    if (partes.length === 0) return null
    const singulares = partes.every((p) => ACOMPANHANTE_SINGULAR.has(p.split(' ')[0]!))
    return singulares ? noIntervalo(1 + partes.length) : null
  }
  if (/^(?:so |somente |apenas )?(?:um|uma)(?: pessoa)?$/.test(t)) return 1
  return null
}
