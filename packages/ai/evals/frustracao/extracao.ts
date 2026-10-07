/**
 * Evals de frustração — camada 1: `frustracao` da triage-v7 (a de produção) com modelo real via OpenRouter ou OpenAI (--provider ou AI_PROVIDER; padrão openrouter).
 * Uso: pnpm --filter @atd/ai eval:frustracao [--modelos a,b,c] [--provider openrouter|openai] [--teto 0.50] [--max-chamadas 200]
 * Custo real, com teto por execução. Grava o relatório em evals/frustracao/resultados/AAAA-MM-DD-frustracao.md.
 * Gate por modelo: acerto ≥ 90%, no máximo 1 falso positivo (handoff desnecessário) e execução completa.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import type { LlmClient } from '../../src/openrouter.ts'
import { clienteDoEval } from '../provedor.ts'
import { triageV7 } from '../../src/triage.ts'
import { custoDaChamada } from '../s1/custo.ts'
import { CONTEXTO } from '../s4/fixture.ts'
import { CASOS_FRUSTRACAO, type CasoFrustracao } from './casos.ts'

export const META_ACERTO = 90
export const MAX_FALSOS_POSITIVOS = 1

export type ResultadoFrustracao = { relatorio: string; motivos: string[]; gastoUsd: number }

export async function rodarFrustracao(p: {
  llm: LlmClient
  modelos: string[]
  teto: number
  maxChamadas: number
  casos?: CasoFrustracao[]
  hoje?: string
}): Promise<ResultadoFrustracao> {
  const casos = p.casos ?? CASOS_FRUSTRACAO
  const percentil = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((xs.length * q) / 100))] ?? 0
  let gastoTotal = 0
  let chamadas = 0
  const motivos: string[] = []
  const linhas: string[] = []
  const detalhes: string[] = []

  for (const modelo of p.modelos) {
    let acertos = 0
    let feitos = 0
    let falsosPositivos = 0
    let falsosNegativos = 0
    let custo = 0
    const latencias: number[] = []
    const erros: string[] = []
    for (const caso of casos) {
      if (gastoTotal >= p.teto) {
        motivos.push(`teto de US$ ${p.teto.toFixed(2)} atingido durante ${modelo}`)
        break
      }
      if (chamadas >= p.maxChamadas) {
        motivos.push(`limite de ${p.maxChamadas} chamadas atingido durante ${modelo}`)
        break
      }
      chamadas++
      const r = await triageV7(p.llm, { models: [modelo], restaurante: CONTEXTO.restaurante, text: caso.mensagem, ...(caso.pendente ? { pendente: caso.pendente } : {}) })
      feitos++
      const usd = custoDaChamada(r.usage)
      custo += usd
      gastoTotal += usd
      latencias.push(r.latencyMs)
      if (!r.ok) {
        erros.push(`- ${caso.id}: falha da chamada (${r.error})`)
        continue
      }
      if (r.data.frustracao === caso.frustracao) {
        acertos++
        continue
      }
      if (r.data.frustracao) falsosPositivos++
      else falsosNegativos++
      erros.push(`- ${caso.id} "${caso.mensagem}": esperado ${caso.frustracao}, veio ${r.data.frustracao}`)
    }
    const pctNum = feitos ? (100 * acertos) / feitos : 0
    if (feitos < casos.length || pctNum < META_ACERTO || falsosPositivos > MAX_FALSOS_POSITIVOS) {
      motivos.push(`${modelo}: ${acertos}/${feitos}, ${falsosPositivos} falso(s) positivo(s) — meta ${META_ACERTO}% e no máximo ${MAX_FALSOS_POSITIVOS}, ou execução parcial`)
    }
    linhas.push(`| ${modelo} | ${acertos}/${feitos} (${pctNum.toFixed(1)}%) | ${falsosPositivos} | ${falsosNegativos} | US$ ${custo.toFixed(4)} | ${percentil(latencias, 50)} ms | ${percentil(latencias, 95)} ms |`)
    detalhes.push(`### ${modelo}\n\n${erros.length ? erros.join('\n') : 'Sem erros.'}\n`)
  }

  const hoje = p.hoje ?? new Date().toISOString().slice(0, 10)
  const total = casos.length
  const comFrustracao = casos.filter((c) => c.frustracao).length
  const relatorio = [
    `# Evals de frustração — triage-v7 (${hoje})`,
    '',
    `Casos: ${total} (${comFrustracao} com frustração, ${total - comFrustracao} sem) · teto: US$ ${p.teto.toFixed(2)} · gasto: US$ ${gastoTotal.toFixed(4)}${motivos.length ? ' (REPROVADO/PARCIAL)' : ''}`,
    ...(motivos.length ? ['', ...motivos.map((m) => `**Falha do gate:** ${m}`)] : []),
    '',
    '| Modelo | Acerto | Falsos positivos | Falsos negativos | Custo total | Latência p50 | Latência p95 |',
    '|---|---|---|---|---|---|---|',
    ...linhas,
    '',
    '## Erros por modelo',
    '',
    ...detalhes,
  ].join('\n')
  return { relatorio, motivos, gastoUsd: gastoTotal }
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { modelos: { type: 'string' }, provider: { type: 'string' }, teto: { type: 'string', default: '0.50' }, 'max-chamadas': { type: 'string', default: '200' } } })
  const modelos = (values.modelos ?? process.env.AI_TRIAGE_MODELS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (modelos.length === 0) throw new Error('Informe --modelos ou AI_TRIAGE_MODELS')
  const teto = Number(values.teto)
  if (!(teto > 0)) throw new Error('--teto deve ser um valor em dólares maior que zero')
  const maxChamadas = Number(values['max-chamadas'])
  if (!Number.isInteger(maxChamadas) || maxChamadas <= 0) throw new Error('--max-chamadas deve ser um inteiro maior que zero')

  const { llm } = clienteDoEval({ provider: values.provider, env: process.env, modelos })
  const r = await rodarFrustracao({ llm, modelos, teto, maxChamadas })
  const hoje = new Date().toISOString().slice(0, 10)
  const pasta = new URL('./resultados/', import.meta.url)
  mkdirSync(pasta, { recursive: true })
  writeFileSync(new URL(`${hoje}-frustracao.md`, pasta), r.relatorio)
  process.stdout.write(`${r.relatorio}\n`)
  if (r.motivos.length > 0) process.exitCode = 1
}
