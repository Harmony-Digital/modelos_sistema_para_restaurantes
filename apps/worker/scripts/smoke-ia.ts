/**
 * Smoke test da IA de produção com o mesmo cliente e a mesma validação do worker (provedor por AI_PROVIDER:
 * openai em produção, store:false; openrouter sempre com ZDR).
 * Uso (raiz do repositório): pnpm --filter @atd/worker smoke:ia:prod
 * Lê .env.worker-producao da raiz (AI_PROVIDER, OPENAI_API_KEY ou OPENROUTER_API_KEY, AI_TRIAGE_MODELS, AI_INGEST_MODELS);
 * os valores do arquivo vencem os do shell. Saída ≠ 0 se algo falhar. Nunca imprime a chave.
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createLlmClient } from '@atd/ai'
import { iaEnvSchema, loadEnv } from '@atd/config'
import { configurarIa } from '../src/ia.ts'
import { ambienteDoSmoke, smokeIa } from '../src/smoke-ia.ts'

const arquivo = fileURLToPath(new URL('../../../.env.worker-producao', import.meta.url))
const falhar = (motivo: string) => {
  process.stdout.write(`FALHA ${motivo}\nResultado: FALHA\n`)
  process.exit(1)
}
if (!existsSync(arquivo)) falhar('.env.worker-producao: not found (crie-o na raiz do repositório; passo 4 do runbook)')

let ia: ReturnType<typeof configurarIa>
try {
  // mesma validação do boot do worker: chave do provedor, modelos e (com openai) preço de cada modelo na tabela
  ia = configurarIa(loadEnv(iaEnvSchema, ambienteDoSmoke(process.env, readFileSync(arquivo, 'utf8'))), 'ia-atendimento-smoke')
} catch (e) {
  falhar(e instanceof Error ? e.message : 'configuração da IA inválida')
  throw e
}
process.stdout.write(`Provedor: ${ia.resumo.provedorIa}\n`)
const r = await smokeIa(createLlmClient(ia.cliente), [ia.resumo.modelosTriagem, ia.resumo.modelosCardapio])
process.stdout.write(`${r.linhas.join('\n')}\nResultado: ${r.ok ? 'OK' : 'FALHA'}\n`)
process.exitCode = r.ok ? 0 : 1
