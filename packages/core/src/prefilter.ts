import { normalizeText } from './normalize.ts'

export type InboundItem = { tipo: 'texto' | 'audio' | 'imagem' | 'documento' | 'outro'; texto: string | null }

export type PrefilterResult =
  | { kind: 'handoff' }
  | { kind: 'lgpd'; tipo: 'acesso' | 'exclusao' }
  | { kind: 'canned'; reply: 'saudacao' | 'agradecimento' }
  | { kind: 'unsupported_media' }
  | { kind: 'pass'; text: string }

const ALVO_FORTE = '(atendente|atendentes|humano|gerente|gerenta|dono|dona|responsavel)'
// "pessoa"/"alguem" são comuns em pedidos ("uma pessoa pra cada pizza"): só valem após falar/chamar/passar.
const ALVO = '(atendente|atendentes|humano|pessoa|alguem|gerente|gerenta|dono|dona|responsavel)'
const DET = '((o|a|um|uma|algum|alguma)\\s+)?'
// Pedido explícito de falar com uma pessoa (texto já normalizado: sem acento, minúsculo).
const HANDOFF_PEDIDO = [
  `\\b(quero|queria|preciso|precisava|posso|gostaria|gostaria de|falar|fala|conversar|conversa)\\b(\\s+\\S+){0,3}?\\s+(com|para|pra)\\s+${DET}${ALVO_FORTE}\\b`,
  `\\b(falar|fala|conversar|conversa)\\b(\\s+\\S+){0,2}?\\s+(com|para|pra)\\s+${DET}(pessoa|alguem)\\b`,
  `\\b(quero|queria|preciso|precisava|gostaria de)(\\s+de)?\\s+${DET}${ALVO_FORTE}\\b`,
  `\\b(chama|chamar|chame|passa|passar|transfere|transferir)\\b(\\s+\\S+){0,2}\\s+${DET}${ALVO}\\b`,
  `\\btem\\s+(algum|alguem)\\s+humano\\b`,
  `\\b(atendimento humano|pessoa de verdade|pessoa real|humano de verdade)\\b`,
  `^(por favor\\s+)?${ALVO}(\\s+(por favor|pf|pfv))?$`,
].map((r) => new RegExp(r))
// A negação só anula o pedido quando qualifica diretamente o alvo; um novo pedido depois ainda vale.
const HANDOFF_NEGATED = new RegExp(
  `\\bnao\\s+(preciso|precisa|quero|quer|necessito|vou querer)(\\s+de)?(\\s+falar\\s+com)?\\s+${DET}${ALVO}(\\s+nenhum)?\\b`,
  'g',
)
const DADOS_PESSOAIS =
  '(meus dados|minhas informacoes|meu cadastro|dados pessoais|tudo (que|o que) (voces|vcs) (sabem|tem) sobre mim)'
const LGPD_EXCLUSAO = new RegExp(
  `\\b(apag|exclu|delet|remov)\\w*\\b(\\s+\\S+){0,3}?\\s+${DADOS_PESSOAIS}|\\bcancel\\w*(\\s+\\S+)?\\s+${DADOS_PESSOAIS}|\\bme\\s+(exclua|exclui|remova|remove|apague|apaga|tire|tira)\\s+do\\s+(cadastro|sistema)\\b`,
)
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

  const semNegados = norm.replace(HANDOFF_NEGATED, ' ').replace(/\s+/g, ' ').trim()
  if (HANDOFF_PEDIDO.some((r) => r.test(semNegados))) return { kind: 'handoff' }
  if (LGPD_EXCLUSAO.test(norm)) return { kind: 'lgpd', tipo: 'exclusao' }
  if (LGPD_ACESSO.test(norm)) return { kind: 'lgpd', tipo: 'acesso' }
  if (norm === '') return { kind: 'canned', reply: 'agradecimento' } // só emoji/pontuação
  if (onlyWordsFrom(norm, GREETING_WORDS)) return { kind: 'canned', reply: 'saudacao' }
  if (onlyWordsFrom(norm, THANKS_WORDS)) return { kind: 'canned', reply: 'agradecimento' }
  return { kind: 'pass', text }
}
