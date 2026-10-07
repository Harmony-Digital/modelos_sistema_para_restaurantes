import { redactPii } from './redact.ts'

/** Mensagens do drizzle trazem "\nparams: <valores>" com texto livre de clientes: corta até o fim da mensagem. */
export function stripQueryParams(s: string): string {
  const i = s.indexOf('\nparams:')
  return i === -1 ? s : `${s.slice(0, i)}\nparams: [redigido]`
}

const V8_FRAME = /^ {4}at .*(:\d+:\d+\)?|\(native\)|<anonymous>\)?)$/m

function cutParams(s: string): string {
  const i = s.indexOf('\nparams:')
  if (i === -1) return s
  const after = s.slice(i + 1)
  const nl = after.indexOf('\n')
  const region = nl === -1 ? '' : after.slice(nl)
  const frame = V8_FRAME.exec(region)
  const tail = frame ? cutParams(region.slice(frame.index)) : ''
  return `${s.slice(0, i)}\nparams: [redigido]${tail ? `\n${tail}` : ''}`
}

/**
 * Stack: troca o texto exato das mensagens originais pela versão sem params e, por segurança,
 * se ainda sobrar "\nparams:", corta até o primeiro frame V8 real (ou o fim).
 */
export function stripStackParams(stack: string, originalMessages: string[]): string {
  let out = stack
  for (const m of originalMessages) {
    const stripped = stripQueryParams(m)
    if (stripped !== m) out = out.split(m).join(stripped)
  }
  return cutParams(out)
}

/**
 * Erros do Postgres trazem a linha ("Failing row contains (…)") ou a chave ("Key (…)=(…)") com os valores, como o nome
 * do cliente numa reserva: tira os valores e mantém o resto (constraint, colunas). Os valores podem ter parênteses
 * desbalanceados ("Carlos :)"), então a redação vai até o fim da linha; da chave, só o final conhecido fica.
 */
export function stripRowValues(s: string): string {
  return s
    .replace(/(Failing row contains )\(.*$/gm, '$1([redigido]).')
    .replace(/(Key \([^)\n]*\))=\(.*?\)( already exists\.| is not present in table "[^"\n]*"\.)?$/gm, '$1=([redigido])$2')
    .replace(/(Key \([^)\n]*\))=\((?!\[redigido\]\)).*$/gm, '$1=([redigido])')
}

const mask = (s: string) => redactPii(stripRowValues(stripQueryParams(s)))

export const SENSITIVE = new Set(['texto', 'text', 'body', 'telefone', 'phone', 'waId', 'to'])

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

function dropSensitive(o: Obj): Obj {
  return Object.fromEntries(Object.entries(o).filter(([k]) => !SENSITIVE.has(k)))
}

/** Campos de erro do Postgres com valores de linha (vêm nos contexts quando o SDK anexa os dados do erro). */
const DADOS_DE_LINHA = new Set(['detail', 'where', 'parameters', 'params', 'query'])
const semDadosDeLinha = (o: Obj): Obj => Object.fromEntries(Object.entries(o).filter(([k]) => !DADOS_DE_LINHA.has(k)))

type ScrubInput = {
  request?: unknown
  user?: unknown
  extra?: Record<string, unknown>
  message?: string
  exception?: { values?: Array<{ value?: string }> }
  contexts?: Record<string, unknown>
  breadcrumbs?: Array<{ data?: Record<string, unknown>; message?: string }>
}

/** Remove PII de eventos do Sentry (web e worker). */
export function scrubEvent<T extends ScrubInput>(event: T): T {
  const out = { ...event }
  if (out.request && typeof out.request === 'object') {
    const rest: Obj = { ...(out.request as Obj) }
    delete rest.data
    delete rest.cookies
    out.request = rest
  }
  delete out.user
  if (out.extra) out.extra = dropSensitive(out.extra)
  if (typeof out.message === 'string') out.message = mask(out.message)
  if (out.exception?.values) {
    out.exception = {
      ...out.exception,
      values: out.exception.values.map((v) => (typeof v.value === 'string' ? { ...v, value: mask(v.value) } : v)),
    }
  }
  if (out.contexts) {
    out.contexts = Object.fromEntries(
      Object.entries(out.contexts).map(([k, v]) => [k, isObj(v) ? semDadosDeLinha(dropSensitive(v)) : v]),
    )
  }
  if (out.breadcrumbs) {
    out.breadcrumbs = out.breadcrumbs.map((b) => ({
      ...b,
      ...(b.data ? { data: dropSensitive(Object.fromEntries(Object.entries(b.data).filter(([k]) => k !== 'arguments'))) } : {}),
      ...(typeof b.message === 'string' ? { message: mask(b.message) } : {}),
    }))
  }
  return out
}
