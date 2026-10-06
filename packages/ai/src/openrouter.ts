import { redactPii } from '@atd/core'

export type LlmUsage = { tokensIn: number; tokensOut: number; tokensCache: number; costUsd: string | null }

export type JsonCallResult<T> =
  | { ok: true; data: T; model: string; usage: LlmUsage; latencyMs: number }
  | { ok: false; error: string; retryable: boolean; status: number | null; model: string | null; usage: LlmUsage | null; latencyMs: number }

/** Parte de uma mensagem do usuário: texto, imagem (data URL) ou PDF (lido pelo motor nativo do modelo). */
export type ConteudoUsuario =
  | { type: 'text'; text: string }
  | { type: 'image'; mime: string; base64: string }
  | { type: 'pdf'; filename: string; base64: string }

export interface LlmClient {
  completeJson<T>(p: {
    models: string[]
    system: string
    /** Texto do usuário; com `userParts`, vai como a primeira parte (texto antes dos anexos, como recomenda o OpenRouter). */
    user: string
    /** Anexos (imagem/PDF) e textos extras, depois de `user`. */
    userParts?: ConteudoUsuario[]
    schemaName: string
    jsonSchema: Record<string, unknown>
    parse: (raw: unknown) => T
    maxTokens: number
    /** Sobrepõe o timeout do cliente (leitura de documento é mais lenta que a triagem). */
    timeoutMs?: number
    /**
     * Padrão false: manda `reasoning: { enabled: false }` — modelo de raciocínio gastava o max_tokens pensando e
     * devolvia `content: null`. true: não manda o campo (o provedor decide).
     */
    reasoning?: boolean
  }): Promise<JsonCallResult<T>>
}

type ApiResponse = {
  model?: string
  choices?: { message?: { content?: string | null }; finish_reason?: string | null }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number } | null
    cost?: number | null
  }
  error?: {
    code?: number
    message?: string
    metadata?: { raw?: unknown; provider_name?: unknown; failed_routing_step?: unknown } | null
  }
}

const MAX_ERRO = 400

/**
 * Mensagem de erro com a causa real: o OpenRouter devolve só "Provider returned error" e põe o motivo
 * do provedor em metadata.raw, e a etapa de roteamento que barrou em metadata.failed_routing_step.
 * O texto vai para log e ai_runs.erro: PII mascarada e tamanho limitado.
 */
function mensagemDeErro(body: ApiResponse, status: number): string {
  const e = body.error
  if (!e?.message) return `HTTP ${status}`
  const md = e.metadata ?? {}
  let detalhe = ''
  if (typeof md.failed_routing_step === 'string') detalhe = `etapa: ${md.failed_routing_step}`
  if (md.raw !== undefined && md.raw !== null) {
    let motivo = typeof md.raw === 'string' ? md.raw : JSON.stringify(md.raw)
    try {
      const raw: unknown = typeof md.raw === 'string' ? JSON.parse(md.raw) : md.raw
      const msg = (raw as { message?: unknown; error?: { message?: unknown } } | null)
      const texto = msg?.message ?? msg?.error?.message
      if (typeof texto === 'string') motivo = texto
    } catch {
      // raw não é JSON: usa o texto como veio
    }
    detalhe = typeof md.provider_name === 'string' ? `${md.provider_name}: ${motivo}` : motivo
  }
  const completa = detalhe ? `${e.message} [${detalhe}]` : e.message
  return redactPii(completa).slice(0, MAX_ERRO)
}

const num = (x: unknown): number => {
  const n = typeof x === 'string' && x.trim() === '' ? NaN : Number(x)
  return Number.isFinite(n) ? n : 0
}

// null = custo desconhecido (ausente, não finito ou negativo); custo > 0 arredonda para CIMA
// (uma chamada paga nunca é registrada como 0).
function toCostUsd(raw: unknown): string | null {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return null
  const c = Number(raw)
  if (!Number.isFinite(c) || c < 0) return null
  if (c === 0) return '0.000000'
  return (Math.ceil(Number((c * 1e6).toFixed(6))) / 1e6).toFixed(6)
}

function toUsage(u: unknown): LlmUsage | null {
  if (typeof u !== 'object' || u === null) return null
  const x = u as NonNullable<ApiResponse['usage']>
  return {
    tokensIn: num(x.prompt_tokens),
    tokensOut: num(x.completion_tokens),
    tokensCache: num(x.prompt_tokens_details?.cached_tokens),
    costUsd: toCostUsd(x.cost),
  }
}

type ParteApi =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { filename: string; file_data: string } }

function parteApi(p: ConteudoUsuario): ParteApi {
  if (p.type === 'text') return { type: 'text', text: p.text }
  if (p.type === 'image') return { type: 'image_url', image_url: { url: `data:${p.mime};base64,${p.base64}` } }
  return { type: 'file', file: { filename: p.filename, file_data: `data:application/pdf;base64,${p.base64}` } }
}

/** content do user: string sem anexos; com anexos, o texto primeiro e as partes depois. PDF sempre pelo motor nativo do modelo (nunca OCR de terceiros). */
function mensagemUsuario(user: string, partes: readonly ConteudoUsuario[] | undefined) {
  if (!partes?.length) return { content: user as string | ParteApi[], plugins: undefined }
  const content: ParteApi[] = [...(user ? [{ type: 'text', text: user } as const] : []), ...partes.map(parteApi)]
  const temPdf = partes.some((p) => p.type === 'pdf')
  return { content, plugins: temPdf ? [{ id: 'file-parser', pdf: { engine: 'native' } }] : undefined }
}

export function createOpenRouterClient(cfg: {
  apiKey: string
  appTitle: string
  fetch?: typeof fetch
  timeoutMs?: number
  /** Só para teste (OpenRouter falso do e2e). */
  baseUrl?: string
  /** SÓ DESENVOLVIMENTO LOCAL (dados inventados): não exige ZDR/data_collection=deny, para modelos grátis. */
  semZdrDev?: boolean
}): LlmClient {
  const doFetch = cfg.fetch ?? fetch
  const endpoint = `${(cfg.baseUrl ?? 'https://openrouter.ai/api/v1').replace(/\/+$/, '')}/chat/completions`
  return {
    async completeJson(p) {
      const started = performance.now()
      const elapsed = () => Math.round(performance.now() - started)
      const usuario = mensagemUsuario(p.user, p.userParts)
      const pedir = (desligarRaciocinio: boolean) => doFetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          'Content-Type': 'application/json',
          'X-Title': cfg.appTitle,
        },
        body: JSON.stringify({
          models: p.models,
          messages: [
            { role: 'system', content: p.system },
            { role: 'user', content: usuario.content },
          ],
          ...(usuario.plugins ? { plugins: usuario.plugins } : {}),
          response_format: {
            type: 'json_schema',
            json_schema: { name: p.schemaName, strict: true, schema: p.jsonSchema },
          },
          // LGPD: em produção sempre deny + zdr; o modo dev só existe na máquina do desenvolvedor
          ...(cfg.semZdrDev ? {} : { provider: { data_collection: 'deny', zdr: true } }),
          ...(desligarRaciocinio ? { reasoning: { enabled: false } } : {}),
          temperature: 0,
          max_tokens: p.maxTokens,
          stream: false,
        }),
        signal: AbortSignal.timeout(p.timeoutMs ?? cfg.timeoutMs ?? 20_000),
      })
      let res: Response
      try {
        const desligar = p.reasoning !== true
        res = await pedir(desligar)
        // modelo com raciocínio obrigatório recusa o desligamento (400 antes de rotear): repete uma vez sem o campo
        if (desligar && res.status === 400) {
          const erro = (await res.clone().json().catch(() => ({}))) as ApiResponse
          if (/reasoning/i.test(erro.error?.message ?? '')) res = await pedir(false)
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'erro de rede'
        return { ok: false, error: msg, retryable: true, status: null, model: null, usage: null, latencyMs: elapsed() }
      }

      const parsed: unknown = await res.json().catch(() => ({}))
      const body = (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : {}) as ApiResponse
      const usage = toUsage(body.usage)
      const model = body.model ?? null
      if (!res.ok) {
        const retryable = res.status >= 500 || res.status === 429 || res.status === 408
        return { ok: false, error: mensagemDeErro(body, res.status), retryable, status: res.status, model, usage, latencyMs: elapsed() }
      }

      try {
        const content = body.choices?.[0]?.message?.content ?? ''
        const data = p.parse(JSON.parse(content))
        return { ok: true, data, model: model ?? p.models[0]!, usage: usage ?? { tokensIn: 0, tokensOut: 0, tokensCache: 0, costUsd: null }, latencyMs: elapsed() }
      } catch {
        // cortada pelo max_tokens: repetir a mesma chamada cobraria de novo e cortaria no mesmo ponto
        if (body.choices?.[0]?.finish_reason === 'length') {
          return { ok: false, error: 'saida_truncada', retryable: false, status: res.status, model, usage, latencyMs: elapsed() }
        }
        return { ok: false, error: 'saida_invalida', retryable: true, status: res.status, model, usage, latencyMs: elapsed() }
      }
    },
  }
}
