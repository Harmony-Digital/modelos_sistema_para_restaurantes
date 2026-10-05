import { normalizeText } from './normalize.ts'

export type InboundItem = { tipo: 'texto' | 'audio' | 'imagem' | 'documento' | 'outro'; texto: string | null }

export type PrefilterResult =
  | { kind: 'handoff' }
  | { kind: 'lgpd'; tipo: 'acesso' | 'exclusao' }
  | { kind: 'canned'; reply: 'saudacao' | 'agradecimento' }
  | { kind: 'unsupported_media' }
  | { kind: 'pass'; text: string }

const HANDOFF = /\b(atendente|humano|atendimento humano|pessoa de verdade|pessoa real|falar com (alguem|uma pessoa|gente|o gerente|gerente))\b/
const HANDOFF_NEGATED = /\bnao\b(\s+\S+){0,3}\s+(atendente|humano)\b/
const LGPD_EXCLUSAO = /\b(apag\w*|exclu\w*|delet\w*|remov\w*)\b(\s+\S+){0,3}\s+dados\b/
const LGPD_ACESSO = /\b(quais|que)\s+(sao\s+os\s+)?(meus\s+)?dados\b.*\b(tem|possuem|guardam|armazenam)\b|\bacesso\s+aos?\s+meus\s+dados\b/

const GREETING_WORDS = new Set(['oi', 'ola', 'opa', 'eai', 'e', 'ai', 'bom', 'boa', 'dia', 'tarde', 'noite', 'tudo', 'bem', 'td', 'hello', 'hey', 'salve'])
const THANKS_WORDS = new Set(['obrigado', 'obrigada', 'brigado', 'brigada', 'valeu', 'vlw', 'ok', 'okay', 'blz', 'beleza', 'show', 'top', 'perfeito', 'perfeita', 'otimo', 'certo', 'entendi', 'agradeco', 'muito', 'mt'])

function onlyWordsFrom(norm: string, set: Set<string>): boolean {
  const words = norm.split(' ').filter(Boolean)
  return words.length > 0 && words.every((w) => set.has(w))
}

export function prefilter(items: InboundItem[]): PrefilterResult {
  const texts = items.map((i) => i.texto?.trim()).filter((s): s is string => !!s)
  const hasMedia = items.some((i) => i.tipo !== 'texto')

  if (texts.length === 0) {
    return hasMedia ? { kind: 'unsupported_media' } : { kind: 'canned', reply: 'agradecimento' }
  }

  const text = texts.join('\n')
  const norm = normalizeText(text)

  if (HANDOFF.test(norm) && !HANDOFF_NEGATED.test(norm)) return { kind: 'handoff' }
  if (LGPD_EXCLUSAO.test(norm)) return { kind: 'lgpd', tipo: 'exclusao' }
  if (LGPD_ACESSO.test(norm)) return { kind: 'lgpd', tipo: 'acesso' }
  if (norm === '') return { kind: 'canned', reply: 'agradecimento' } // só emoji/pontuação
  if (onlyWordsFrom(norm, GREETING_WORDS)) return { kind: 'canned', reply: 'saudacao' }
  if (onlyWordsFrom(norm, THANKS_WORDS)) return { kind: 'canned', reply: 'agradecimento' }
  return { kind: 'pass', text }
}
