/**
 * Evals S2 — camada 1: extração da reserva (padrão triage-v7, com as frases do S2 e os casos da reserva com pergunta
 * pendente; --triagem v6|v5|v4|v3 mede as versões anteriores só nas frases) com modelo real via OpenRouter ou OpenAI
 * (--provider ou AI_PROVIDER; padrão openrouter).
 * Uso: pnpm --filter @atd/ai eval:s2 [--modelos a,b,c] [--provider openrouter|openai] [--teto 0.50] [--triagem v7|v6|v5|v4|v3] (padrão v7)
 * Custo real, com teto por execução. Grava o relatório em evals/s2/resultados/AAAA-MM-DD-extracao.md.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { triageV3, triageV4, triageV5, triageV6, triageV7, type PendenteTriagem } from '../../src/triage.ts'
import type { ContextoS1, ItemExtraido } from '@atd/core'
import { lerTriagem } from '../triagem.ts'
import { custoDaChamada } from '../s1/custo.ts'
import { FRASES } from './casos.ts'
import { extracaoCorretaReserva, extracaoCorretaS2 } from './comparar.ts'
import { CASOS_RESERVA, gabaritoDa } from './reserva.ts'
import { CONTEXTO, CONTEXTO_PEQUENO } from './fixture.ts'
import { clienteDoEval } from '../provedor.ts'

const { values } = parseArgs({ options: { modelos: { type: 'string' }, provider: { type: 'string' }, triagem: { type: 'string' }, teto: { type: 'string', default: '0.50' }, 'max-chamadas': { type: 'string', default: '500' } } })
const modelos = (values.modelos ?? process.env.AI_TRIAGE_MODELS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
if (modelos.length === 0) throw new Error('Informe --modelos ou AI_TRIAGE_MODELS')
const triagem = lerTriagem(values.triagem, 'v3')
const extrair = triagem === 'v7' ? triageV7 : triagem === 'v6' ? triageV6 : triagem === 'v5' ? triageV5 : triagem === 'v4' ? triageV4 : triageV3
const teto = Number(values.teto)
if (!(teto > 0)) throw new Error('--teto deve ser um valor em dólares maior que zero')

const maxChamadas = Number(values['max-chamadas'])
if (!Number.isInteger(maxChamadas) || maxChamadas <= 0) throw new Error('--max-chamadas deve ser um inteiro maior que zero')

type Entrada = {
  id: string; mensagem: string; agora: string; ctx: ContextoS1; pendente?: PendenteTriagem; itens: ItemExtraido[]
  correta: (esperado: ItemExtraido[], obtido: ItemExtraido[], ctx: ContextoS1, agora: Date) => boolean
}
// a v7 também mede a reserva: nome, resposta do contato e respostas curtas com a pergunta pendente
const ENTRADAS: Entrada[] = [
  ...FRASES.map((f) => ({
    id: f.id, mensagem: f.mensagem, agora: f.agora, ctx: f.contexto === 'pequeno' ? CONTEXTO_PEQUENO : CONTEXTO,
    itens: gabaritoDa(triagem, f.id, f.itens), correta: extracaoCorretaS2,
  })),
  ...(triagem === 'v7'
    ? CASOS_RESERVA.map((c) => ({
      id: c.id, mensagem: c.mensagem, agora: c.agora, ctx: CONTEXTO, itens: c.itens, correta: extracaoCorretaReserva,
      ...(c.pendente ? { pendente: c.pendente } : {}),
    }))
    : []),
]

const { llm } = clienteDoEval({ provider: values.provider, env: process.env, modelos })
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
  for (const caso of ENTRADAS) {
    if (gastoTotal >= teto) {
      motivos.push(`teto de US$ ${teto.toFixed(2)} atingido durante ${modelo}`)
      break
    }
    if (chamadas >= maxChamadas) {
      motivos.push(`limite de ${maxChamadas} chamadas atingido durante ${modelo}`)
      break
    }
    chamadas++
    const r = await extrair(llm, { models: [modelo], restaurante: CONTEXTO.restaurante, text: caso.mensagem, ...(caso.pendente ? { pendente: caso.pendente } : {}) })
    feitos++
    const usd = custoDaChamada(r.usage)
    custo += usd
    gastoTotal += usd
    latencias.push(r.latencyMs)
    if (!r.ok) {
      erros.push(`- ${caso.id}: falha da chamada (${r.error})`)
      continue
    }
    if (caso.correta(caso.itens, r.data.itens, caso.ctx, new Date(caso.agora))) acertos++
    else erros.push(`- ${caso.id} "${caso.mensagem}": ${JSON.stringify(r.data.itens)}`)
  }
  if (feitos < ENTRADAS.length || (100 * acertos) / Math.max(feitos, 1) < META) {
    motivos.push(`${modelo}: ${acertos}/${feitos} abaixo da meta de ${META}% ou execução parcial`)
  }
  const pct = feitos ? ((100 * acertos) / feitos).toFixed(1) : '0'
  linhas.push(`| ${modelo} | ${acertos}/${feitos} (${pct}%) | US$ ${custo.toFixed(4)} | US$ ${(feitos ? custo / feitos : 0).toFixed(6)} | ${percentil(latencias, 50)} ms | ${percentil(latencias, 95)} ms |`)
  detalhes.push(`### ${modelo}\n\n${erros.length ? erros.join('\n') : 'Sem erros.'}\n`)
}

const hoje = new Date().toISOString().slice(0, 10)
const relatorio = [
  `# Evals S2 — extração da reserva, triagem ${triagem} (${hoje})`,
  '',
  `Frases: ${ENTRADAS.length} · teto: US$ ${teto.toFixed(2)} · gasto: US$ ${gastoTotal.toFixed(4)}${motivos.length ? ' (REPROVADO/PARCIAL)' : ''}`,
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
