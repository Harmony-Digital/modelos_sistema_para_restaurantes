import { normalizeText } from '../normalize.ts'
import { lerPessoas, type LeituraPessoas } from '../s2/pessoas.ts'
import type { TipoEvento } from './tipos.ts'

export const MIN_CONVIDADOS = 1
export const MAX_CONVIDADOS = 1000
/** Texto original do tipo, como o cliente disse (coluna `tipo_texto`). */
export const MAX_TIPO_TEXTO = 60

// a ordem importa: "confraternização da empresa" é confraternização; "festa de fim de ano da firma" é corporativo
const REGRAS: readonly [RegExp, TipoEvento][] = [
  [/\bconfraterniza/, 'confraternizacao'],
  [/\b(aniversario|aniver|niver|niverzinho|\d{1,3} anos|debutante|debut)\b/, 'aniversario'],
  [/\b(casamento|casorio|bodas|noivado|matrimonio)\b/, 'casamento'],
  [/\b(empresa|firma|corporativo|corporativa|trabalho|escritorio|reuniao|equipe|colegas)\b/, 'corporativo'],
  [/\b(fim de ano|final de ano|encontro|reencontro|amigos|amigas)\b/, 'confraternizacao'],
]

/** "niver" ⇒ aniversário; "bodas" ⇒ casamento; "reunião da firma" ⇒ corporativo; outro texto ⇒ outro; vazio ⇒ null. */
export function normalizarTipoEvento(texto: string | null): { tipo: TipoEvento; texto: string } | null {
  const t = normalizeText(texto ?? '')
  if (!t) return null
  const original = texto!.trim().slice(0, MAX_TIPO_TEXTO).trim()
  const tipo = REGRAS.find(([re]) => re.test(t))?.[1] ?? 'outro'
  return { tipo, texto: original }
}

const ROTULOS: Readonly<Record<Exclude<TipoEvento, 'outro'>, string>> = {
  aniversario: 'aniversário',
  casamento: 'casamento',
  corporativo: 'evento corporativo',
  confraternizacao: 'confraternização',
}

/** Como o tipo aparece nas mensagens: rótulo pt-BR; `outro` usa o texto do cliente. */
export function rotuloTipoEvento(tipo: TipoEvento, texto: string | null): string {
  if (tipo === 'outro') return texto?.trim() || 'evento'
  return ROTULOS[tipo]
}

/** Resposta curta a "Para quantos convidados?" — o parser de pessoas do S2 com os limites do S3 (1–1000). */
export function lerConvidados(texto: string): LeituraPessoas {
  return lerPessoas(texto, { min: MIN_CONVIDADOS, max: MAX_CONVIDADOS })
}
