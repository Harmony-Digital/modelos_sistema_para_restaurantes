/**
 * Mostra o que o cliente receberia, usando o banco local e a triagem real.
 * Uso: pnpm --filter @atd/worker perguntar "abre domingo?" [--agora 2026-10-11T10:00:00-03:00]
 *      pnpm --filter @atd/worker perguntar --itens '[{"servico":"horario_unidades","tipo":"aberto_agora","unidade":"asa sul","data":null,"tema":null}]'
 * Não grava nada no banco nem envia mensagem.
 */
import { parseArgs } from 'node:util'
import { createOpenRouterClient, parseTriageV2, triageV2, type TriageV2 } from '@atd/ai'
import { resolverS1 } from '@atd/core'
import { carregarContextoS1, createDb, getSingleRestaurantId } from '@atd/db'

const { values, positionals } = parseArgs({ allowPositionals: true, options: { agora: { type: 'string' }, itens: { type: 'string' } } })
const mensagem = positionals.join(' ').trim()
if (!mensagem && !values.itens) throw new Error('Uso: perguntar "sua pergunta" [--agora ISO] | --itens JSON')
const agora = values.agora ? new Date(values.agora) : new Date()
if (Number.isNaN(agora.getTime())) throw new Error('--agora inválido (ex.: 2026-10-11T10:00:00-03:00)')
if (!process.env.DATABASE_URL) throw new Error('Defina DATABASE_URL')

const { db, sql } = createDb(process.env.DATABASE_URL)
try {
  const ctx = await carregarContextoS1(db, await getSingleRestaurantId(db), agora)
  let itens: TriageV2['itens']
  if (values.itens) {
    itens = parseTriageV2({ itens: JSON.parse(values.itens), fora_escopo: false }).itens
  } else {
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) throw new Error('Sem OPENROUTER_API_KEY: use --itens para testar sem a IA')
    const modelos = (process.env.AI_TRIAGE_MODELS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    const r = await triageV2(createOpenRouterClient({ apiKey, appTitle: 'ia-atendimento-cli' }), { models: modelos, restaurante: ctx.restaurante, text: mensagem })
    if (!r.ok) throw new Error(`Triagem falhou: ${r.error}`)
    process.stdout.write(`Modelo: ${r.model} · custo: US$ ${r.usage.costUsd ?? '?'} · ${r.latencyMs} ms\n`)
    itens = r.data.itens
  }
  process.stdout.write(`Itens extraídos:\n${JSON.stringify(itens, null, 2)}\n`)
  const res = resolverS1(itens, ctx, agora)
  process.stdout.write(`\n--- Mensagem ao cliente ---\n${res.texto ?? '(sem texto de S1: fora de escopo, atendente ou só a lista)'}\n`)
  for (const l of res.localizacoes) process.stdout.write(`\n[localização] ${l.nome} (${l.lat}, ${l.lng}) — ${l.endereco}\n`)
  if (res.lista) {
    process.stdout.write(`\n[lista] ${res.lista.corpo}\n${res.lista.opcoes.map((o) => `  • ${o.titulo} — ${o.descricao}`).join('\n')}\n`)
  }
  if (res.lacunas.length) process.stdout.write(`\n[lacunas] ${res.lacunas.map((l) => l.chave).join(', ')}\n`)
  process.stdout.write(`\nItens de S1: ${res.respondidos}/${res.validos} respondidos com dado\n`)
} finally {
  await sql.end()
}
