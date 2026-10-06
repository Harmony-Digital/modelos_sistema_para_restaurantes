/** Preço de um modelo em USD por 1M tokens: entrada, entrada em cache e saída. */
export type PrecoModelo = { entrada: number; cache: number; saida: number }

/**
 * Preços do nível Standard da OpenAI (texto). Fonte: https://developers.openai.com/api/docs/pricing
 * (consultada na data abaixo). Ao mudar a lista de modelos de produção, conferir o preço na fonte e
 * atualizar a data — modelo sem preço impede o worker de subir.
 */
export const PRECOS_CONSULTADOS_EM = '2026-10-06'

export const PRECOS_OPENAI: Record<string, PrecoModelo> = {
  'gpt-4.1': { entrada: 2.0, cache: 0.5, saida: 8.0 },
  'gpt-4.1-mini': { entrada: 0.4, cache: 0.1, saida: 1.6 },
  'gpt-4.1-nano': { entrada: 0.1, cache: 0.025, saida: 0.4 },
  'gpt-5-mini': { entrada: 0.25, cache: 0.025, saida: 2.0 },
  'gpt-5-nano': { entrada: 0.05, cache: 0.005, saida: 0.4 },
}

/** A API devolve o snapshot datado (ex.: gpt-4.1-mini-2025-04-14): cai no preço do alias. */
function precoDe(modelo: string): PrecoModelo | null {
  if (Object.hasOwn(PRECOS_OPENAI, modelo)) return PRECOS_OPENAI[modelo]!
  const alias = modelo.replace(/-\d{4}-\d{2}-\d{2}$/, '')
  return alias !== modelo && Object.hasOwn(PRECOS_OPENAI, alias) ? PRECOS_OPENAI[alias]! : null
}

/**
 * Custo em USD (string com 6 casas, como `ai_runs.custo_usd`); null se o modelo não está na tabela.
 * `tokensIn` inclui os tokens em cache (como `usage.prompt_tokens`), que são descontados e cobrados pelo preço de cache.
 * Arredonda para CIMA em micro-USD: uma chamada paga nunca é registrada como 0.
 */
export function custoOpenAi(modelo: string, u: { tokensIn: number; tokensCache: number; tokensOut: number }): string | null {
  const p = precoDe(modelo)
  if (!p) return null
  const cache = Math.min(Math.max(u.tokensCache, 0), Math.max(u.tokensIn, 0))
  const semCache = Math.max(u.tokensIn, 0) - cache
  // preço por 1M tokens × tokens = micro-USD
  const micro = semCache * p.entrada + cache * p.cache + Math.max(u.tokensOut, 0) * p.saida
  return (Math.ceil(Number(micro.toFixed(6))) / 1e6).toFixed(6)
}

/** Modelos da lista sem preço cadastrado (o boot do worker recusa subir com algum). */
export function modelosSemPreco(modelos: string[]): string[] {
  return modelos.filter((m) => precoDe(m) === null)
}
