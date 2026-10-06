import { modelosSemPreco, PRECOS_OPENAI, type createLlmClient } from '@atd/ai'
import type { IaEnv } from '@atd/config'

export type ConfigCliente = Parameters<typeof createLlmClient>[0]

/**
 * Configuração do cliente de IA a partir da env já validada (`workerEnvSchema`/`iaEnvSchema`): mesma regra no boot do
 * worker e no smoke test. Com a OpenAI, todo modelo das listas precisa de preço em `precos-openai.ts` (sem ele o custo
 * não seria calculável e a liquidação do orçamento ficaria cega): recusa listando os modelos. Nunca põe segredo no resumo.
 */
export function configurarIa(env: IaEnv, appTitle: string): {
  cliente: ConfigCliente
  resumo: { provedorIa: IaEnv['AI_PROVIDER']; modelosTriagem: string[]; modelosCardapio: string[] }
} {
  const modelosTriagem = [...env.AI_TRIAGE_MODELS]
  const modelosCardapio = [...(env.AI_INGEST_MODELS ?? [])]
  const resumo = { provedorIa: env.AI_PROVIDER, modelosTriagem, modelosCardapio }

  if (env.AI_PROVIDER === 'openai') {
    if (!env.OPENAI_API_KEY) throw new Error('Defina OPENAI_API_KEY (AI_PROVIDER=openai)')
    const semPreco = [...new Set(modelosSemPreco([...modelosTriagem, ...modelosCardapio]))]
    if (semPreco.length) {
      throw new Error(
        `Modelo(s) sem preço cadastrado em packages/ai/src/precos-openai.ts: ${semPreco.join(', ')} ` +
          `(cadastrados: ${Object.keys(PRECOS_OPENAI).join(', ')}). Confira AI_TRIAGE_MODELS e AI_INGEST_MODELS.`,
      )
    }
    return { cliente: { provider: 'openai', apiKey: env.OPENAI_API_KEY, ...(env.OPENAI_BASE_URL ? { baseUrl: env.OPENAI_BASE_URL } : {}) }, resumo }
  }

  if (!env.OPENROUTER_API_KEY) throw new Error('Defina OPENROUTER_API_KEY (AI_PROVIDER=openrouter)')
  return {
    cliente: {
      provider: 'openrouter',
      apiKey: env.OPENROUTER_API_KEY,
      appTitle,
      ...(env.OPENROUTER_BASE_URL ? { baseUrl: env.OPENROUTER_BASE_URL } : {}),
      ...(env.OPENROUTER_DEV_SEM_ZDR ? { semZdrDev: true } : {}),
    },
    resumo,
  }
}
