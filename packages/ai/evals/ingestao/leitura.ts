/**
 * Eval de leitura de cardápio por IA (PDF/imagem ⇒ rascunho) com modelo real via OpenRouter ou OpenAI (--provider ou AI_PROVIDER; padrão openrouter).
 * Uso: pnpm --filter @atd/ai eval:ingestao [--modelos a,b] [--provider openrouter|openai] [--teto 1.00]
 * Só roda com a chave do provedor (OPENROUTER_API_KEY ou OPENAI_API_KEY) e AI_INGEST_MODELS (ou --modelos). Meta: ≥ 90% de nome + preço corretos por modelo.
 * Arquivos de exemplo INVENTADOS em evals/ingestao/exemplos/ (regenerar com gerar-exemplos.ts).
 * Grava o relatório em evals/ingestao/resultados/AAAA-MM-DD-leitura.md.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { INGESTAO_BUDGET_ESTIMATE_USD, lerCardapioPorIa } from '../../src/ingestao.ts'
import { EXEMPLOS } from './gabarito.ts'
import { PASTA_EXEMPLOS } from './gerar-exemplos.ts'
import { pontuarIngestao } from './pontuar.ts'
import { clienteDoEval } from '../provedor.ts'

const { values } = parseArgs({ options: { modelos: { type: 'string' }, provider: { type: 'string' }, teto: { type: 'string', default: '1.00' } } })
const modelos = (values.modelos ?? process.env.AI_INGEST_MODELS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
if (modelos.length === 0) throw new Error('Informe --modelos ou AI_INGEST_MODELS')
const teto = Number(values.teto)
if (!(teto > 0)) throw new Error('--teto deve ser um valor em dólares maior que zero')

const { llm } = clienteDoEval({ provider: values.provider, env: process.env, modelos })
const custo = (u: { costUsd: string | null } | null) => {
  const real = u?.costUsd == null ? Number.NaN : Number(u.costUsd)
  return Number.isFinite(real) && real >= 0 ? real : Number(INGESTAO_BUDGET_ESTIMATE_USD)
}
const META = 90
let gastoTotal = 0
const motivos: string[] = []
const linhas: string[] = []
const detalhes: string[] = []

for (const modelo of modelos) {
  let acertos = 0
  let total = 0
  let gasto = 0
  let feitos = 0
  const erros: string[] = []
  for (const ex of EXEMPLOS) {
    if (gastoTotal >= teto) {
      motivos.push(`teto de US$ ${teto.toFixed(2)} atingido durante ${modelo}`)
      break
    }
    const base64 = readFileSync(new URL(ex.arquivo, PASTA_EXEMPLOS)).toString('base64')
    const r = await lerCardapioPorIa(llm, { models: [modelo], arquivo: { mime: ex.mime, base64, filename: ex.arquivo } })
    feitos++
    const usd = custo(r.usage)
    gasto += usd
    gastoTotal += usd
    const itens = ex.categorias.reduce((n, c) => n + c.itens.length, 0)
    total += itens
    if (!r.ok) {
      erros.push(`- ${ex.arquivo}: falha da chamada (${r.error}) em ${r.latencyMs} ms`)
      continue
    }
    const p = pontuarIngestao(ex, r.data)
    acertos += p.acertos
    erros.push(`- ${ex.arquivo}: ${p.acertos}/${p.total} em ${r.latencyMs} ms`
      + `${p.faltando.length ? ` · faltando: ${p.faltando.join(', ')}` : ''}`
      + `${p.precoErrado.length ? ` · preço errado: ${p.precoErrado.join('; ')}` : ''}`
      + `${p.inventados.length ? ` · a mais: ${p.inventados.join(', ')}` : ''}`)
  }
  const pct = total ? (100 * acertos) / total : 0
  if (feitos < EXEMPLOS.length || pct < META) motivos.push(`${modelo}: ${acertos}/${total} abaixo da meta de ${META}% ou execução parcial`)
  linhas.push(`| ${modelo} | ${acertos}/${total} (${pct.toFixed(1)}%) | US$ ${gasto.toFixed(4)} |`)
  detalhes.push(`### ${modelo}\n\n${erros.join('\n')}\n`)
}

const hoje = new Date().toISOString().slice(0, 10)
const relatorio = [
  `# Eval de leitura de cardápio por IA (${hoje})`,
  '',
  `Arquivos: ${EXEMPLOS.map((e) => e.arquivo).join(', ')} · teto: US$ ${teto.toFixed(2)} · gasto: US$ ${gastoTotal.toFixed(4)}${motivos.length ? ' (REPROVADO/PARCIAL)' : ''}`,
  ...(motivos.length ? ['', ...motivos.map((m) => `**Falha do gate:** ${m}`)] : []),
  '',
  '| Modelo | Nome + preço corretos | Custo |',
  '|---|---|---|',
  ...linhas,
  '',
  '## Detalhes por modelo',
  '',
  ...detalhes,
].join('\n')
const pasta = new URL('./resultados/', import.meta.url)
mkdirSync(pasta, { recursive: true })
writeFileSync(new URL(`${hoje}-leitura.md`, pasta), relatorio)
process.stdout.write(`${relatorio}\n`)
if (motivos.length > 0) process.exitCode = 1
