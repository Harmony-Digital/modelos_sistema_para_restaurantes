/**
 * Evals S2 — camada 1: extração de avisos de presença (padrão triage-v5; --triagem v4|v3 mede as versões anteriores) com modelo real via OpenRouter.
 * Uso: pnpm --filter @atd/ai eval:s2 [--modelos a,b,c] [--teto 0.50] [--triagem v5|v4|v3] (padrão v5)
 * Custo real, com teto por execução. Grava o relatório em evals/s2/resultados/AAAA-MM-DD-extracao.md.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { createOpenRouterClient } from '../../src/openrouter.ts'
import { triageV3, triageV4, triageV5 } from '../../src/triage.ts'
import { lerTriagem } from '../triagem.ts'
import { custoDaChamada } from '../s1/custo.ts'
import { FRASES } from './casos.ts'
import { extracaoCorretaS2 } from './comparar.ts'
import { CONTEXTO, CONTEXTO_PEQUENO } from './fixture.ts'

const { values } = parseArgs({ options: { modelos: { type: 'string' }, triagem: { type: 'string' }, teto: { type: 'string', default: '0.50' }, 'max-chamadas': { type: 'string', default: '500' } } })
const apiKey = process.env.OPENROUTER_API_KEY
if (!apiKey) throw new Error('Defina OPENROUTER_API_KEY (no .env da raiz ou no ambiente)')
const modelos = (values.modelos ?? process.env.AI_TRIAGE_MODELS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
if (modelos.length === 0) throw new Error('Informe --modelos ou AI_TRIAGE_MODELS')
const triagem = lerTriagem(values.triagem, 'v3')
const extrair = triagem === 'v5' ? triageV5 : triagem === 'v4' ? triageV4 : triageV3
const teto = Number(values.teto)
if (!(teto > 0)) throw new Error('--teto deve ser um valor em dólares maior que zero')

const maxChamadas = Number(values['max-chamadas'])
if (!Number.isInteger(maxChamadas) || maxChamadas <= 0) throw new Error('--max-chamadas deve ser um inteiro maior que zero')

const llm = createOpenRouterClient({ apiKey, appTitle: 'ia-atendimento-evals', semZdrDev: process.env.OPENROUTER_DEV_SEM_ZDR === '1' && process.env.NODE_ENV !== 'production' })
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
  for (const caso of FRASES) {
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
    if (extracaoCorretaS2(caso.itens, r.data.itens, ctx, new Date(caso.agora))) acertos++
    else erros.push(`- ${caso.id} "${caso.mensagem}": ${JSON.stringify(r.data.itens)}`)
  }
  if (feitos < FRASES.length || (100 * acertos) / Math.max(feitos, 1) < META) {
    motivos.push(`${modelo}: ${acertos}/${feitos} abaixo da meta de ${META}% ou execução parcial`)
  }
  const pct = feitos ? ((100 * acertos) / feitos).toFixed(1) : '0'
  linhas.push(`| ${modelo} | ${acertos}/${feitos} (${pct}%) | US$ ${custo.toFixed(4)} | US$ ${(feitos ? custo / feitos : 0).toFixed(6)} | ${percentil(latencias, 50)} ms | ${percentil(latencias, 95)} ms |`)
  detalhes.push(`### ${modelo}\n\n${erros.length ? erros.join('\n') : 'Sem erros.'}\n`)
}

const hoje = new Date().toISOString().slice(0, 10)
const relatorio = [
  `# Evals S2 — extração de avisos, triagem ${triagem} (${hoje})`,
  '',
  `Frases: ${FRASES.length} · teto: US$ ${teto.toFixed(2)} · gasto: US$ ${gastoTotal.toFixed(4)}${motivos.length ? ' (REPROVADO/PARCIAL)' : ''}`,
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
