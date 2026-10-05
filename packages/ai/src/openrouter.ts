export type LlmUsage = { tokensIn: number; tokensOut: number; tokensCache: number; costUsd: string | null }

export type JsonCallResult<T> =
  | { ok: true; data: T; model: string; usage: LlmUsage; latencyMs: number }
  | { ok: false; error: string; retryable: boolean; status: number | null; model: string | null; usage: LlmUsage | null; latencyMs: number }

export interface LlmClient {
  completeJson<T>(p: {
    models: string[]
    system: string
    user: string
    schemaName: string
    jsonSchema: Record<string, unknown>
    parse: (raw: unknown) => T
    maxTokens: number
  }): Promise<JsonCallResult<T>>
}

type ApiResponse = {
  model?: string
  choices?: { message?: { content?: string | null } }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number } | null
    cost?: number | null
  }
  error?: { code?: number; message?: string }
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

export function createOpenRouterClient(cfg: {
  apiKey: string
  appTitle: string
  fetch?: typeof fetch
  timeoutMs?: number
}): LlmClient {
  const doFetch = cfg.fetch ?? fetch
  return {
    async completeJson(p) {
      const started = performance.now()
      const elapsed = () => Math.round(performance.now() - started)
      let res: Response
      try {
        res = await doFetch('https://openrouter.ai/api/v1/chat/completions', {
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
              { role: 'user', content: p.user },
            ],
            response_format: {
              type: 'json_schema',
              json_schema: { name: p.schemaName, strict: true, schema: p.jsonSchema },
            },
            provider: { data_collection: 'deny', zdr: true },
            temperature: 0,
            max_tokens: p.maxTokens,
            stream: false,
          }),
          signal: AbortSignal.timeout(cfg.timeoutMs ?? 20_000),
        })
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
        return { ok: false, error: body.error?.message ?? `HTTP ${res.status}`, retryable, status: res.status, model, usage, latencyMs: elapsed() }
      }

      try {
        const content = body.choices?.[0]?.message?.content ?? ''
        const data = p.parse(JSON.parse(content))
        return { ok: true, data, model: model ?? p.models[0]!, usage: usage ?? { tokensIn: 0, tokensOut: 0, tokensCache: 0, costUsd: null }, latencyMs: elapsed() }
      } catch {
        return { ok: false, error: 'saida_invalida', retryable: true, status: res.status, model, usage, latencyMs: elapsed() }
      }
    },
  }
}
