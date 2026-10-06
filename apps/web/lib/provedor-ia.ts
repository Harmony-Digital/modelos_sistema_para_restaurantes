export type RotuloProvedor = 'OpenAI' | 'OpenRouter'

/**
 * Rótulo do provedor de IA em uso, para o quadro de Gastos (só servidor: lê o ambiente).
 * `AI_PROVIDER` vence quando está definido. Sem ele, produção é OpenAI (o worker recusa outro provedor em produção e a
 * Vercel não recebe `AI_PROVIDER` — ver `scripts/producao/verificar.sh`) e o resto é OpenRouter (padrão do worker).
 */
export function rotuloProvedorIa(e: Record<string, string | undefined> = process.env): RotuloProvedor {
  if (e.AI_PROVIDER === 'openai') return 'OpenAI'
  if (e.AI_PROVIDER === 'openrouter') return 'OpenRouter'
  return e.NODE_ENV === 'production' ? 'OpenAI' : 'OpenRouter'
}
