/**
 * Evals S1 — camada 1: extração (triage-v2) com modelo real via OpenRouter.
 * Uso: pnpm --filter @atd/ai eval:s1 [--modelos a,b,c] [--teto 0.50]
 * Custo real, com teto por execução. Grava o relatório em evals/s1/resultados/AAAA-MM-DD-extracao.md.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { createOpenRouterClient } from '../../src/openrouter.ts'
import { triageV2 } from '../../src/triage.ts'
import { CASOS } from './casos.ts'
import { extracaoCorreta } from './comparar.ts'
import { CONTEXTO, CONTEXTO_PEQUENO } from './fixture.ts'

const { values } = parseArgs({ options: { modelos: { type: 'string' }, teto: { type: 'string', default: '0.50' } } })
const apiKey = process.env.OPENROUTER_API_KEY
if (!apiKey) throw new Error('Defina OPENROUTER_API_KEY (no .env da raiz ou no ambiente)')
const modelos = (values.modelos ?? process.env.AI_TRIAGE_MODELS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
if (modelos.length === 0) throw new Error('Informe --modelos ou AI_TRIAGE_MODELS')
const teto = Number(values.teto)
if (!(teto > 0)) throw new Error('--teto deve ser um valor em dólares maior que zero')

const llm = createOpenRouterClient({ apiKey, appTitle: 'ia-atendimento-evals' })
const percentil = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((xs.length * p) / 100))] ?? 0
let gastoTotal = 0
const linhas: string[] = []
const detalhes: string[] = []

for (const modelo of modelos) {
  let acertos = 0
  let feitos = 0
  let custo = 0
  const latencias: number[] = []
  const erros: string[] = []
  for (const caso of CASOS) {
    if (gastoTotal >= teto) break
    const r = await triageV2(llm, { models: [modelo], restaurante: CONTEXTO.restaurante, text: caso.mensagem })
    feitos++
    const usd = Number(r.usage?.costUsd ?? 0)
    custo += usd
    gastoTotal += usd
    latencias.push(r.latencyMs)
    if (!r.ok) {
      erros.push(`- ${caso.id}: falha da chamada (${r.error})`)
      continue
    }
    const ctx = caso.contexto === 'pequeno' ? CONTEXTO_PEQUENO : CONTEXTO
    if (extracaoCorreta(caso.itens, r.data.itens, ctx, new Date(caso.agora))) acertos++
    else erros.push(`- ${caso.id} "${caso.mensagem}": ${JSON.stringify(r.data.itens)}`)
  }
  const pct = feitos ? ((100 * acertos) / feitos).toFixed(1) : '0'
  linhas.push(`| ${modelo} | ${acertos}/${feitos} (${pct}%) | US$ ${custo.toFixed(4)} | US$ ${(feitos ? custo / feitos : 0).toFixed(6)} | ${percentil(latencias, 50)} ms | ${percentil(latencias, 95)} ms |`)
  detalhes.push(`### ${modelo}\n\n${erros.length ? erros.join('\n') : 'Sem erros.'}\n`)
}

const hoje = new Date().toISOString().slice(0, 10)
const relatorio = [
  `# Evals S1 — extração (${hoje})`,
  '',
  `Casos: ${CASOS.length} · teto: US$ ${teto.toFixed(2)} · gasto: US$ ${gastoTotal.toFixed(4)}${gastoTotal >= teto ? ' (teto atingido: execução parcial)' : ''}`,
  '',
  '| Modelo | Acerto | Custo total | Custo por mensagem | Latência p50 | Latência p95 |',
  '|---|---|---|---|---|---|',
  ...linhas,
  '',
  '## Erros por modelo',
  '',
  ...detalhes,
].join('\n')
const pasta = new URL('./resultados/', import.meta.url)
mkdirSync(pasta, { recursive: true })
writeFileSync(new URL(`${hoje}-extracao.md`, pasta), relatorio)
process.stdout.write(`${relatorio}\n`)
