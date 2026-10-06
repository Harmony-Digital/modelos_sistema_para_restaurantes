/**
 * Eval de leitura de documento por IA (PDF/imagens ⇒ rascunho por alvo) com modelo real via OpenRouter ou OpenAI
 * (--provider ou AI_PROVIDER; padrão openrouter).
 * Uso: pnpm --filter @atd/ai eval:ingestao [--alvo todos|cardapio|so_precos|informacoes|horarios|espacos] [--modelos a,b]
 *      [--provider openrouter|openai] [--teto 1.00]
 * Só roda com a chave do provedor (OPENROUTER_API_KEY ou OPENAI_API_KEY) e AI_INGEST_MODELS (ou --modelos).
 * Meta: ≥ 90% por modelo e grupo, e nenhuma linha de injeção obedecida.
 * Documentos de exemplo INVENTADOS em evals/ingestao/exemplos/ (regenerar com gerar-exemplos.ts).
 * Grava o relatório em evals/ingestao/resultados/AAAA-MM-DD-leitura[-alvo].md.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { clienteDoEval } from '../provedor.ts'
import { CASOS_EVAL, GRUPOS_EVAL } from './casos.ts'
import { executarEvalIngestao } from './executar.ts'
import { EVAL_HOJE } from './gabarito.ts'
import { PASTA_EXEMPLOS } from './gerar-exemplos.ts'

const { values } = parseArgs({
  options: {
    alvo: { type: 'string', default: 'todos' },
    modelos: { type: 'string' },
    provider: { type: 'string' },
    teto: { type: 'string', default: '1.00' },
  },
})
const alvo = values.alvo
if (alvo !== 'todos' && !(GRUPOS_EVAL as readonly string[]).includes(alvo)) throw new Error(`--alvo deve ser todos ou um de: ${GRUPOS_EVAL.join(', ')}`)
const modelos = (values.modelos ?? process.env.AI_INGEST_MODELS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
if (modelos.length === 0) throw new Error('Informe --modelos ou AI_INGEST_MODELS')
const teto = Number(values.teto)
if (!(teto > 0)) throw new Error('--teto deve ser um valor em dólares maior que zero')

const { llm } = clienteDoEval({ provider: values.provider, env: process.env, modelos })
const data = new Date().toISOString().slice(0, 10)
const { relatorio, motivos } = await executarEvalIngestao({
  llm,
  modelos,
  casos: alvo === 'todos' ? CASOS_EVAL : CASOS_EVAL.filter((c) => c.grupo === alvo),
  teto,
  hoje: EVAL_HOJE,
  lerArquivo: (nome) => readFileSync(new URL(nome, PASTA_EXEMPLOS)),
  data,
})
const pasta = new URL('./resultados/', import.meta.url)
mkdirSync(pasta, { recursive: true })
writeFileSync(new URL(`${data}-leitura${alvo === 'todos' ? '' : `-${alvo}`}.md`, pasta), relatorio)
process.stdout.write(`${relatorio}\n`)
if (motivos.length > 0) process.exitCode = 1
