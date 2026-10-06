import { parseEnv } from 'node:util'
import { createLlmClient, type ProvedorIa } from '../src/llm.ts'
import type { LlmClient } from '../src/openrouter.ts'
import { modelosSemPreco, PRECOS_OPENAI } from '../src/precos-openai.ts'

type Env = Record<string, string | undefined>

/**
 * Cliente dos evals pelo provedor escolhido: `--provider` (flag) > `AI_PROVIDER` > `openrouter` (padrão, .env local antigo).
 * OpenAI: modelo sem preço na tabela é recusado antes de gastar (o teto do eval soma o custo calculado).
 * OpenRouter: sempre deny + zdr, salvo a chave de desenvolvimento local (`OPENROUTER_DEV_SEM_ZDR=1`, nunca em produção).
 */
export function clienteDoEval(opcoes: { provider?: string | undefined; env: Env; modelos: string[] }): { llm: LlmClient; provedor: ProvedorIa } {
  const { env } = opcoes
  const escolhido = opcoes.provider ?? (env.AI_PROVIDER || 'openrouter')
  if (escolhido !== 'openrouter' && escolhido !== 'openai') throw new Error('--provider (ou AI_PROVIDER) deve ser openrouter ou openai')

  if (escolhido === 'openai') {
    const apiKey = env.OPENAI_API_KEY
    if (!apiKey) throw new Error('Defina OPENAI_API_KEY (provedor openai)')
    const semPreco = modelosSemPreco(opcoes.modelos)
    if (semPreco.length) {
      throw new Error(`Modelo(s) sem preço cadastrado em packages/ai/src/precos-openai.ts: ${semPreco.join(', ')} (cadastrados: ${Object.keys(PRECOS_OPENAI).join(', ')})`)
    }
    return { provedor: 'openai', llm: createLlmClient({ provider: 'openai', apiKey, ...(env.OPENAI_BASE_URL ? { baseUrl: env.OPENAI_BASE_URL } : {}) }) }
  }

  const apiKey = env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error('Defina OPENROUTER_API_KEY (no .env da raiz ou no ambiente)')
  return {
    provedor: 'openrouter',
    llm: createLlmClient({
      provider: 'openrouter',
      apiKey,
      appTitle: 'ia-atendimento-evals',
      semZdrDev: env.OPENROUTER_DEV_SEM_ZDR === '1' && env.NODE_ENV !== 'production',
    }),
  }
}

/** Evals do portão de qualidade de produção (`pnpm --filter @atd/ai eval:prod`), na ordem em que rodam. */
export const EVALS_PROD = [
  { nome: 's1', script: 'evals/s1/extracao.ts' },
  { nome: 's2', script: 'evals/s2/extracao.ts' },
  { nome: 's3', script: 'evals/s3/extracao.ts' },
  { nome: 's4', script: 'evals/s4/extracao.ts' },
  { nome: 'frustracao', script: 'evals/frustracao/extracao.ts' },
] as const

/**
 * Ambiente dos evals de produção: o arquivo `.env.worker-producao` VENCE o shell (diferente de `node --env-file`, que não
 * sobrescreve), para um `.env` local carregado antes não trocar os modelos nem o provedor; força `AI_PROVIDER=openai`
 * e nunca usa `OPENAI_BASE_URL` (só e2e local).
 */
export function ambienteDoEvalProd(shell: Env, arquivo: string): Env {
  const env: Env = { ...shell, ...parseEnv(arquivo), AI_PROVIDER: 'openai' }
  delete env.OPENAI_BASE_URL
  return env
}
