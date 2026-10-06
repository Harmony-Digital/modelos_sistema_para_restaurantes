/**
 * Evals S1 — camada 1: extração (padrão triage-v4; --triagem v2 mede a versão anterior) com modelo real via OpenRouter.
 * Uso: pnpm --filter @atd/ai eval:s1 [--modelos a,b,c] [--teto 0.50] [--triagem v4|v2] (padrão v4)
 * Custo real, com teto por execução. Grava o relatório em evals/s1/resultados/AAAA-MM-DD-extracao.md.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { createOpenRouterClient } from '../../src/openrouter.ts'
import { triageV2, triageV4 } from '../../src/triage.ts'
import { lerTriagem } from '../triagem.ts'
import { CASOS } from './casos.ts'
import { extracaoCorreta } from './comparar.ts'
import { custoDaChamada } from './custo.ts'
import { CONTEXTO, CONTEXTO_PEQUENO } from './fixture.ts'

const { values } = parseArgs({ options: { modelos: { type: 'string' }, triagem: { type: 'string' }, teto: { type: 'string', default: '0.50' }, 'max-chamadas': { type: 'string', default: '500' } } })
const apiKey = process.env.OPENROUTER_API_KEY
if (!apiKey) throw new Error('Defina OPENROUTER_API_KEY (no .env da raiz ou no ambiente)')
const modelos = (values.modelos ?? process.env.AI_TRIAGE_MODELS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
if (modelos.length === 0) throw new Error('Informe --modelos ou AI_TRIAGE_MODELS')
const triagem = lerTriagem(values.triagem, 'v2')
const extrair = triagem === 'v4' ? triageV4 : triageV2
const teto = Number(values.teto)
if (!(teto > 0)) throw new Error('--teto deve ser um valor em dólares maior que zero')

const maxChamadas = Number(values['max-chamadas'])
if (!Number.isInteger(maxChamadas) || maxChamadas <= 0) throw new Error('--max-chamadas deve ser um inteiro maior que zero')

const llm = createOpenRouterClient({ apiKey, appTitle: 'ia-atendimento-evals' })
const percentil = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((xs.length * p) / 100))] ?? 0
let gastoTotal = 0
let chamadas = 0
const motivos: string[] = []
const META = 95
const linhas: string[] = []
const detalhes: string[] = []

for (const modelo of modelos) {
  let acertos = 0
  let feitos = 0
  let custo = 0
  const latencias: number[] = []
  const erros: string[] = []
  for (const caso of CASOS) {
    if (gastoTotal >= teto) {
      motivos.push(`teto de US$ ${teto.toFixed(2)} atingido durante ${modelo}`)
      break
    }
    if (chamadas >= maxChamadas) {
      motivos.push(`limite de ${maxChamadas} chamadas atingido durante ${modelo}`)
      break
    }
    chamadas++
    const r = await extrair(llm, { models: [modelo], restaurante: CONTEXTO.restaurante, text: caso.mensagem })
    feitos++
    const usd = custoDaChamada(r.usage)
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
  if (feitos < CASOS.length || (100 * acertos) / Math.max(feitos, 1) < META) {
    motivos.push(`${modelo}: ${acertos}/${feitos} abaixo da meta de ${META}% ou execução parcial`)
  }
  const pct = feitos ? ((100 * acertos) / feitos).toFixed(1) : '0'
  linhas.push(`| ${modelo} | ${acertos}/${feitos} (${pct}%) | US$ ${custo.toFixed(4)} | US$ ${(feitos ? custo / feitos : 0).toFixed(6)} | ${percentil(latencias, 50)} ms | ${percentil(latencias, 95)} ms |`)
  detalhes.push(`### ${modelo}\n\n${erros.length ? erros.join('\n') : 'Sem erros.'}\n`)
}

const hoje = new Date().toISOString().slice(0, 10)
const relatorio = [
  `# Evals S1 — extração, triagem ${triagem} (${hoje})`,
  '',
  `Casos: ${CASOS.length} · teto: US$ ${teto.toFixed(2)} · gasto: US$ ${gastoTotal.toFixed(4)}${motivos.length ? ' (REPROVADO/PARCIAL)' : ''}`,
  ...(motivos.length ? ['', ...motivos.map((m) => `**Falha do gate:** ${m}`)] : []),
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
if (motivos.length > 0) process.exitCode = 1
