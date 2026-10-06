import { mensagemDeErro, num, parteApi, type ApiResponse, type ConteudoUsuario, type JsonCallResult, type LlmClient, type LlmUsage, type ParteApi } from './openrouter.ts'
import { custoOpenAi } from './precos-openai.ts'

/** Família de raciocínio: gpt-5* e o-series (o1, o3, o4-mini…). */
const ehRaciocinio = (modelo: string) => /^gpt-5/.test(modelo) || /^o\d/.test(modelo)

/**
 * Menor esforço aceito por modelo (doc: "Not all reasoning models support every value"):
 * gpt-5/-mini/-nano → 'minimal'; gpt-5.x → 'none'; o-series → 'low'.
 */
function esforcoMinimo(modelo: string): 'none' | 'minimal' | 'low' {
  if (/^o\d/.test(modelo)) return 'low'
  if (/^gpt-5\.\d/.test(modelo)) return 'none'
  return 'minimal'
}

/** Códigos em que o modelo recusa a si mesmo (inexistente/sem acesso) ou um parâmetro: vale tentar o próximo da lista. */
const RECUSA_DO_MODELO = new Set(['model_not_found', 'unsupported_parameter', 'unsupported_value'])

function conteudoUsuario(user: string, partes: readonly ConteudoUsuario[] | undefined): string | ParteApi[] {
  if (!partes?.length) return user
  return [...(user ? [{ type: 'text', text: user } as const] : []), ...partes.map(parteApi)]
}

function usageOpenAi(u: ApiResponse['usage'], modelo: string): LlmUsage | null {
  if (typeof u !== 'object' || u === null) return null
  const base = {
    tokensIn: num(u.prompt_tokens),
    tokensOut: num(u.completion_tokens),
    tokensCache: num(u.prompt_tokens_details?.cached_tokens),
  }
  return { ...base, costUsd: custoOpenAi(modelo, base) }
}

/**
 * Cliente direto da API da OpenAI (Chat Completions), com o mesmo contrato do OpenRouter.
 * LGPD: `store: false` sempre; nada de conteúdo em log (o corpo, com base64 de anexos, só vai no fetch).
 * Reserva: tenta os modelos em ordem; passa ao próximo em 429/5xx/408/timeout/rede ou recusa do modelo/parâmetro;
 * 4xx de requisição inválida para na hora. Resposta paga (200) nunca é repetida em outro modelo.
 */
export function createOpenAiClient(cfg: { apiKey: string; baseUrl?: string; timeoutMs?: number; fetch?: typeof fetch }): LlmClient {
  const doFetch = cfg.fetch ?? fetch
  const endpoint = `${(cfg.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '')}/chat/completions`
  return {
    async completeJson(p) {
      const started = performance.now()
      const elapsed = () => Math.round(performance.now() - started)
      const content = conteudoUsuario(p.user, p.userParts)
      let falha: Extract<JsonCallResult<never>, { ok: false }> = { ok: false, error: 'sem modelos', retryable: false, status: null, model: null, usage: null, latencyMs: 0 }

      for (const modelo of p.models) {
        const raciocinio = ehRaciocinio(modelo)
        let res: Response
        try {
          res = await doFetch(endpoint, {
            method: 'POST',
            headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: modelo,
              messages: [
                { role: 'system', content: p.system },
                { role: 'user', content },
              ],
              response_format: { type: 'json_schema', json_schema: { name: p.schemaName, strict: true, schema: p.jsonSchema } },
              store: false,
              // modelos de raciocínio recusam temperature diferente do padrão
              ...(raciocinio ? {} : { temperature: 0 }),
              ...(raciocinio && p.reasoning !== true ? { reasoning_effort: esforcoMinimo(modelo) } : {}),
              max_completion_tokens: p.maxTokens,
              stream: false,
            }),
            signal: AbortSignal.timeout(p.timeoutMs ?? cfg.timeoutMs ?? 20_000),
          })
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'erro de rede'
          falha = { ok: false, error: msg, retryable: true, status: null, model: null, usage: null, latencyMs: elapsed() }
          continue
        }

        const parsed: unknown = await res.json().catch(() => ({}))
        const body = (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : {}) as ApiResponse
        const usado = body.model ?? modelo
        const usage = usageOpenAi(body.usage, usado)

        if (!res.ok) {
          const transitorio = res.status >= 500 || res.status === 429 || res.status === 408
          const codigo = body.error?.code
          const recusa = res.status === 404 || (typeof codigo === 'string' && RECUSA_DO_MODELO.has(codigo))
          falha = { ok: false, error: mensagemDeErro(body, res.status), retryable: transitorio, status: res.status, model: body.model ?? null, usage, latencyMs: elapsed() }
          if (transitorio || recusa) continue
          return falha
        }

        const escolha = body.choices?.[0]
        const semUsage = { tokensIn: 0, tokensOut: 0, tokensCache: 0, costUsd: null }
        // cortada pelo max_completion_tokens: repetir cobraria de novo e cortaria no mesmo ponto
        if (escolha?.finish_reason === 'length') {
          return { ok: false, error: 'saida_truncada', retryable: false, status: res.status, model: usado, usage, latencyMs: elapsed() }
        }
        if (escolha?.message?.refusal) {
          return { ok: false, error: 'saida_invalida', retryable: true, status: res.status, model: usado, usage, latencyMs: elapsed() }
        }
        try {
          const data = p.parse(JSON.parse(escolha?.message?.content ?? ''))
          return { ok: true, data, model: usado, usage: usage ?? semUsage, latencyMs: elapsed() }
        } catch {
          return { ok: false, error: 'saida_invalida', retryable: true, status: res.status, model: usado, usage, latencyMs: elapsed() }
        }
      }
      return { ...falha, latencyMs: elapsed() }
    },
  }
}
