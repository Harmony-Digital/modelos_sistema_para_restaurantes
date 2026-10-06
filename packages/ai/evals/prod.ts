/**
 * Portão de qualidade de produção: triagem S1–S4 e frustração contra a OpenAI, com o env de produção.
 * Uso (raiz do repositório): pnpm --filter @atd/ai eval:prod
 * Lê .env.worker-producao da raiz (OPENAI_API_KEY, AI_TRIAGE_MODELS); os valores do arquivo vencem os do shell e o
 * provedor é sempre openai. Roda todos os evals (custo real, centavos, com o teto de cada um) e sai ≠ 0 se algum reprovar.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ambienteDoEvalProd, EVALS_PROD } from './provedor.ts'

const arquivo = fileURLToPath(new URL('../../../.env.worker-producao', import.meta.url))
if (!existsSync(arquivo)) {
  process.stderr.write('.env.worker-producao: not found (crie-o na raiz do repositório; ver passo 6 do runbook)\n')
  process.exit(1)
}
const env = ambienteDoEvalProd(process.env, readFileSync(arquivo, 'utf8'))
const pasta = fileURLToPath(new URL('../', import.meta.url))

const resultado: string[] = []
for (const e of EVALS_PROD) {
  process.stdout.write(`\n=== eval ${e.nome} (openai: ${env.AI_TRIAGE_MODELS ?? '?'}) ===\n`)
  const r = spawnSync(process.execPath, [e.script, '--provider', 'openai'], { cwd: pasta, env, stdio: 'inherit' })
  resultado.push(`${r.status === 0 ? 'OK' : 'FALHA'} ${e.nome}`)
}
process.stdout.write(`\n${resultado.join('\n')}\nResultado: ${resultado.every((l) => l.startsWith('OK')) ? 'OK' : 'FALHA'}\n`)
process.exitCode = resultado.every((l) => l.startsWith('OK')) ? 0 : 1
