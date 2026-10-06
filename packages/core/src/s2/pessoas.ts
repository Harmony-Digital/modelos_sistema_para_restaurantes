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
// lista fechada: "eu e a família", "eu e o pessoal", "eu e a galera" não dizem quantos ⇒ null
const ACOMPANHANTE_SINGULAR = new RegExp(
  '^(?:(?:meu|minha|o|a|um|uma)\\s+)?(?:esposa|esposo|marido|mulher|namorada|namorado|noiva|noivo|filho|filha|amigo|amiga|'
  + 'mae|pai|irmao|irma|sogro|sogra|colega|parceiro|parceira|companheiro|companheira|ele|ela)$',
)
// número junto de hora ou data ("dia 12", "2 da tarde", "amanhã às 8", "20h", "10/10") não é quantidade de pessoas
const HORA_OU_DATA = new RegExp(
  '\\d\\s*h\\b|\\d\\s*hs\\b|\\d\\s*horas?\\b|\\bda (?:tarde|noite|manha|madrugada)\\b|\\b(?:as|dia|amanha|hoje|depois|'
  + 'segunda|terca|quarta|quinta|sexta|sabado|domingo|feriado|semana|mes)\\b',
)

/** `'fora'`: número claro acima do limite ("somos 80"): o worker responde o limite sem chamar o modelo. */
export type LeituraPessoas = number | 'fora' | null

/** Faixa aceita: avisos (S2) 1–60; convidados de evento (S3) 1–1000. */
export type LimitesPessoas = { min: number; max: number }

/**
 * Lê a quantidade de pessoas de uma resposta curta ("4", "somos 5", "quatro", "eu e minha esposa").
 * Ambíguo, zero ou com hora/data no meio ⇒ null (nunca chuta); acima do máximo (padrão 60) ⇒ `'fora'`.
 */
export function lerPessoas(texto: string, limites: LimitesPessoas = { min: MIN_PESSOAS, max: MAX_PESSOAS }): LeituraPessoas {
  // até 3 dígitos ("100" ⇒ 'fora' num aviso) ou os do máximo (1000 ⇒ 4): "2026" não vira 'fora' num aviso
  const digitos = new RegExp(`^\\d{1,${Math.max(3, String(limites.max).length)}}$`)
  const valor = (token: string): number | null =>
    digitos.test(token) ? Number(token) : (POR_EXTENSO[token] ?? (UM.has(token) ? 1 : null))
  const noIntervalo = (n: number | null): LeituraPessoas => {
    if (n === null || !Number.isInteger(n) || n < limites.min) return null
    return n > limites.max ? 'fora' : n
  }
  if (/[/:]/.test(texto)) return null // "10/10", "19:30"
  const t = normalizeText(texto)
  if (!t || DUVIDA.test(t) || HORA_OU_DATA.test(t)) return null
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
    const singulares = partes.every((p) => ACOMPANHANTE_SINGULAR.test(p))
    return singulares ? noIntervalo(1 + partes.length) : null
  }
  if (/^(?:so |somente |apenas )?(?:um|uma)(?: pessoa)?$/.test(t)) return 1
  return null
}
