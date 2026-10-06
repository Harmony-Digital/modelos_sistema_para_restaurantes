/**
 * Smoke test do OpenRouter de produção com o mesmo cliente do worker (sempre com ZDR).
 * Uso (raiz do repositório): pnpm --filter @atd/worker smoke:openrouter:prod
 * Lê ../../.env.worker-producao (OPENROUTER_API_KEY, AI_TRIAGE_MODELS, AI_INGEST_MODELS). Saída ≠ 0 se algo falhar.
 */
import { createOpenRouterClient } from '@atd/ai'
import { smokeOpenRouter } from '../src/smoke-openrouter.ts'

const apiKey = process.env.OPENROUTER_API_KEY
if (!apiKey) throw new Error('Defina OPENROUTER_API_KEY no .env.worker-producao')
const lista = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean)

// semZdrDev nunca: o smoke test confere justamente o caminho de produção
const r = await smokeOpenRouter(createOpenRouterClient({ apiKey, appTitle: 'ia-atendimento-smoke' }), [
  lista(process.env.AI_TRIAGE_MODELS),
  lista(process.env.AI_INGEST_MODELS),
])
process.stdout.write(`${r.linhas.join('\n')}\nResultado: ${r.ok ? 'OK' : 'FALHA'}\n`)
process.exitCode = r.ok ? 0 : 1
