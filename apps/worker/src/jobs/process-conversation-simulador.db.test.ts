import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import { keyFromBase64, periodStarts } from '@atd/core'
import { abrirSimulacao, enviarMensagemSimulada, schema, type Enqueue } from '@atd/db'
import { getTestDb, resetDb, seedRestaurant, seedStaff } from '@atd/db/test-utils'
import type { LlmClient, TriageV5 } from '@atd/ai'
import { createLogger } from '../logger.ts'
import { comMidiaProibida, storageProibido } from './midia-fake.ts'
import { agoraDaConversa, processConversation, type ProcessDeps } from './process-conversation.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const phoneKey = keyFromBase64(Buffer.alloc(32, 7).toString('base64'))
const noopEnqueue: Enqueue = async () => undefined
const log = createLogger('silent')
const SEG_14H = new Date('2026-10-05T14:00:00-03:00')
const DOM_12H = new Date('2026-10-11T12:00:00-03:00')

const item = (tipo: string) =>
  ({ servico: 'horario_unidades', tipo, unidade: null, data: null, tema: null, pessoas: null, horario: null, convidados: null, tipoEvento: null, espaco: null, consulta: null, tag: null }) as TriageV5['itens'][number]
const servico = (s: string) =>
  ({ servico: s, tipo: null, unidade: null, data: null, tema: null, pessoas: null, horario: null, convidados: null, tipoEvento: null, espaco: null, consulta: null, tag: null }) as TriageV5['itens'][number]

function fakeLlm(script: TriageV5[]) {
  let n = 0
  const llm: LlmClient = {
    async completeJson(p) {
      const data = p.parse({ frustracao: false, ...script[Math.min(n++, script.length - 1)] })
      return { ok: true as const, data, model: 'fake/m', usage: { tokensIn: 10, tokensOut: 5, tokensCache: 0, costUsd: '0.000100' }, latencyMs: 5 }
    },
  }
  return llm
}

/** Qualquer chamada à Meta numa conversa simulada é defeito. */
const waProibido = {
  async sendText(): Promise<never> { throw new Error('sendText chamado em simulação') },
  async sendLocation(): Promise<never> { throw new Error('sendLocation chamado em simulação') },
  async sendList(): Promise<never> { throw new Error('sendList chamado em simulação') },
}

const deps = (llm: LlmClient): ProcessDeps =>
  ({ db, llm, wa: comMidiaProibida(waProibido), storage: storageProibido, phoneKey, triageModels: ['fake/m'], log, requeue: async () => undefined, now: () => SEG_14H })

async function setup() {
  const { restaurantId, unitId } = await seedRestaurant(db)
  await db.update(schema.units).set({ endereco: 'SCLS 404', cidade: 'Brasília', uf: 'DF', lat: -15.81, lng: -47.89 }).where(eq(schema.units.id, unitId))
  await db.insert(schema.unitHours).values({ restaurantId, unitId, weekday: 0, turno: 1, abre: '11:30', fecha: '16:00' })
  await db.insert(schema.budgetLimits).values([
    { restaurantId, escopo: 'ia', periodo: 'dia', limiteUsd: '1' },
    { restaurantId, escopo: 'ia', periodo: 'mes', limiteUsd: '10' },
  ])
  const dono = await seedStaff(db, sql, { restaurantId, papel: 'dono' })
  const p = { restaurantId, userId: dono }
  const { conversationId } = await abrirSimulacao(db, p)
  const enviar = (texto: string) => enviarMensagemSimulada(db, { ...p, conversationId, texto }, noopEnqueue)
  return { restaurantId, conversationId, enviar }
}

const saidas = (conversationId: string) =>
  db.select().from(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId))
    .orderBy(asc(schema.messages.id))
    .then((ms) => ms.filter((m) => m.direcao === 'out'))

describe('canal simulador no worker', () => {
  it('responde pelo pipeline real, marca "simulado" e nunca chama a Meta nem decifra telefone', async () => {
    const { conversationId, enviar } = await setup()
    await enviar('estão abertos agora?')
    expect(await processConversation(deps(fakeLlm([{ itens: [item('aberto_agora')], fora_escopo: false }])), conversationId)).toBe('replied')
    const out = await saidas(conversationId)
    expect(out.length).toBeGreaterThanOrEqual(2) // aviso de privacidade + resposta
    expect(out.every((m) => m.statusEnvio === 'simulado' && m.wamid === null)).toBe(true)
    const [cliente] = await db.select().from(schema.customers)
    expect(cliente!.privacyNoticeSentAt).not.toBeNull()
    const runs = await db.select().from(schema.aiRuns)
    expect(runs.every((r) => r.simulado)).toBe(true)
  })

  it('relógio simulado: domingo 12h responde "aberta" (segunda 14h real estaria fechada), mas o orçamento conta no dia real', async () => {
    const { conversationId, enviar, restaurantId } = await setup()
    const offset = Math.round((DOM_12H.getTime() - SEG_14H.getTime()) / 1000)
    await db.update(schema.conversations).set({ relogioOffsetSegundos: offset }).where(eq(schema.conversations.id, conversationId))
    await enviar('estão abertos agora?')
    await processConversation(deps(fakeLlm([{ itens: [item('aberto_agora')], fora_escopo: false }])), conversationId)
    const out = await saidas(conversationId)
    expect(out.at(-1)!.texto).toMatch(/está aberta agora/)
    const contadores = await db.select().from(schema.budgetCounters).where(eq(schema.budgetCounters.restaurantId, restaurantId))
    const dia = contadores.find((c) => c.periodo === 'dia')!
    expect(dia.inicioPeriodo).toBe(periodStarts(new Date(), 'America/Sao_Paulo').dia)
  })

  it('sem relógio simulado, a mesma pergunta usa o relógio real (segunda 14h: fechada)', async () => {
    const { conversationId, enviar } = await setup()
    await enviar('estão abertos agora?')
    await processConversation(deps(fakeLlm([{ itens: [item('aberto_agora')], fora_escopo: false }])), conversationId)
    expect((await saidas(conversationId)).at(-1)!.texto).toMatch(/está fechada agora/)
  })

  it('pedido de atendente na simulação: vai para aguardando_humano, sem lacuna e fora da fila real', async () => {
    const { conversationId, enviar } = await setup()
    await enviar('quero falar com um atendente')
    await processConversation(deps(fakeLlm([{ itens: [servico('humano')], fora_escopo: false }])), conversationId)
    const [conv] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, conversationId))
    expect(conv!.estado).toBe('aguardando_humano')
    expect((await saidas(conversationId)).every((m) => m.statusEnvio === 'simulado')).toBe(true)
  })

  it('pergunta sem dado na simulação não cria lacuna', async () => {
    const { conversationId, enviar } = await setup()
    await enviar('tem estacionamento?')
    await processConversation(deps(fakeLlm([{ itens: [{ ...item('info'), tema: 'estacionamento' }], fora_escopo: false }])), conversationId)
    expect(await db.select().from(schema.knowledgeGaps)).toEqual([])
  })
})

describe('agoraDaConversa', () => {
  const real = new Date('2026-10-05T17:00:00Z')
  it('conversa real ignora qualquer deslocamento', () => {
    expect(agoraDaConversa(real, { simulada: false, relogioOffsetSegundos: 3600 })).toEqual(real)
  })
  it('conversa simulada sem relógio usa o real', () => {
    expect(agoraDaConversa(real, { simulada: true, relogioOffsetSegundos: null })).toEqual(real)
  })
  it('conversa simulada soma o deslocamento', () => {
    expect(agoraDaConversa(real, { simulada: true, relogioOffsetSegundos: -60 })).toEqual(new Date('2026-10-05T16:59:00Z'))
  })
})
