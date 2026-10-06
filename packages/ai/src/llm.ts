import { createOpenAiClient } from './openai.ts'
import { createOpenRouterClient, type LlmClient } from './openrouter.ts'

export type ProvedorIa = 'openrouter' | 'openai'

/** Escolhe a implementação de `LlmClient` pelo provedor configurado (produção: openai). */
export function createLlmClient(
  cfg:
    | { provider: 'openrouter'; apiKey: string; baseUrl?: string; semZdrDev?: boolean; timeoutMs?: number; appTitle?: string }
    | { provider: 'openai'; apiKey: string; baseUrl?: string; timeoutMs?: number },
): LlmClient {
  if (cfg.provider === 'openai') {
    return createOpenAiClient({
      apiKey: cfg.apiKey,
      ...(cfg.baseUrl ? { baseUrl: cfg.baseUrl } : {}),
      ...(cfg.timeoutMs ? { timeoutMs: cfg.timeoutMs } : {}),
    })
  }
  return createOpenRouterClient({
    apiKey: cfg.apiKey,
    appTitle: cfg.appTitle ?? 'ia-atendimento',
    ...(cfg.baseUrl ? { baseUrl: cfg.baseUrl } : {}),
    ...(cfg.timeoutMs ? { timeoutMs: cfg.timeoutMs } : {}),
    ...(cfg.semZdrDev ? { semZdrDev: true } : {}),
  })
}
