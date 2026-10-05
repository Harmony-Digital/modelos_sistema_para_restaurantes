import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import { encryptPhone, keyFromBase64 } from '@atd/core'
import { ingestInbound, schema, type Enqueue } from '@atd/db'
import { getTestDb, resetDb, seedRestaurant } from '@atd/db/test-utils'
import type { LlmClient, TriageV2 } from '@atd/ai'
import type { SendResult } from '@atd/whatsapp'
import { createLogger } from '../logger.ts'
import { processConversation, type ProcessDeps } from './process-conversation.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const phoneKey = keyFromBase64(Buffer.alloc(32, 7).toString('base64'))
const noopEnqueue: Enqueue = async () => undefined
const log = createLogger('silent')
const SEG_14H = new Date('2026-10-05T14:00:00-03:00')

const h = (tipo: string, extra: Record<string, string | null> = {}) =>
  ({ servico: 'horario_unidades', tipo, unidade: null, data: null, tema: null, ...extra }) as TriageV2['itens'][number]

async function setup(nUnidades: 1 | 4 = 1) {
  const { restaurantId, unitId } = await seedRestaurant(db)
  await db.update(schema.restaurants).set({ nome: 'Casa Teste', politicaUrl: 'https://casa.test/privacidade' })
  await db.update(schema.units).set({
    endereco: 'SCLS 404 Bloco C', bairro: 'Asa Sul', cidade: 'Brasília', uf: 'DF', lat: -15.8136, lng: -47.896, ordem: 1,
  }).where(eq(schema.units.id, unitId))
  await db.insert(schema.unitHours).values([
    { restaurantId, unitId, weekday: 0, turno: 1, abre: '11:30', fecha: '16:00' },
    { restaurantId, unitId, weekday: 2, turno: 1, abre: '11:30', fecha: '15:00' },
  ])
  const ids: Record<string, string> = { 'Asa Sul': unitId }
  if (nUnidades === 4) {
    for (const [i, nome] of ['Asa Norte', 'Lago Sul', 'Águas Claras'].entries()) {
      const [u] = await db.insert(schema.units).values({ restaurantId, nome, slug: `u${i}`, ordem: i + 2 }).returning()
      ids[nome] = u!.id
      for (let d = 0; d < 7; d++) await db.insert(schema.unitHours).values({ restaurantId, unitId: u!.id, weekday: d, turno: 1, abre: '11:00', fecha: '23:00' })
    }
  }
  await db.insert(schema.budgetLimits).values([
    { restaurantId, escopo: 'ia', periodo: 'dia', limiteUsd: '1' },
    { restaurantId, escopo: 'ia', periodo: 'mes', limiteUsd: '10' },
  ])
  return { restaurantId, ids }
}

async function receive(restaurantId: string, texto: string, interativoId: string | null = null) {
  const r = await ingestInbound(db, {
    restaurantId, waIdHash: 'hash-maria', telefoneCifrado: encryptPhone('5561999998888', phoneKey), profileName: 'Maria',
    timestamp: new Date(), wamid: `wamid.${randomUUID()}`, tipo: 'texto', texto, mediaId: null, interativoId,
  }, noopEnqueue)
  return r.conversationId
}

function fakeLlm(script: TriageV2[]) {
  const calls: string[] = []
  const llm: LlmClient = {
    async completeJson(p) {
      calls.push(p.user)
      return {
        ok: true as const, data: p.parse(script[Math.min(calls.length - 1, script.length - 1)]), model: 'fake/m',
        usage: { tokensIn: 100, tokensOut: 20, tokensCache: 0, costUsd: '0.000200' }, latencyMs: 10,
      }
    },
  }
  return { llm, calls }
}

function fakeWa() {
  const enviados: { tipo: string; to: string; corpo: unknown }[] = []
  const ok = (): SendResult => ({ ok: true, wamid: `wamid.out.${randomUUID()}` })
  return {
    enviados,
    async sendText(to: string, texto: string) { enviados.push({ tipo: 'texto', to, corpo: texto }); return ok() },
    async sendLocation(to: string, loc: unknown) { enviados.push({ tipo: 'localizacao', to, corpo: loc }); return ok() },
    async sendList(to: string, l: unknown) { enviados.push({ tipo: 'lista', to, corpo: l }); return ok() },
  }
}

const deps = (llm: LlmClient, wa: ReturnType<typeof fakeWa>): ProcessDeps =>
  ({ db, llm, wa, phoneKey, triageModels: ['fake/m'], log, requeue: async () => undefined, now: () => SEG_14H })
const conversa = async (id: string) => (await db.select().from(schema.conversations).where(eq(schema.conversations.id, id)))[0]!

describe('S1 no worker', () => {
  it('"abre domingo?" responde com o horário do banco e conta o item', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'abre domingo?')
    const { llm } = fakeLlm([{ itens: [h('horario_dia', { data: 'domingo' })], fora_escopo: false }])
    const wa = fakeWa()
    expect(await processConversation(deps(llm, wa), conv)).toBe('replied')
    expect(wa.enviados.map((e) => e.corpo)).toEqual([
      expect.stringContaining('assistente virtual'), // aviso de privacidade (primeiro contato)
      'Domingo (11/10), a unidade Asa Sul abre das 11h30 às 16h.',
    ])
    const [run] = await db.select().from(schema.aiRuns)
    expect(run).toMatchObject({ promptVersion: 'triage-v2', itensValidos: 1, itensRespondidos: 1, simulado: false, intent: 'horario_unidades:horario_dia' })
  })

  it('endereço sai como texto e como localização, nessa ordem', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'qual o endereço?')
    const { llm } = fakeLlm([{ itens: [h('endereco')], fora_escopo: false }])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    expect(wa.enviados.slice(1)).toEqual([
      { tipo: 'texto', to: '5561999998888', corpo: 'A unidade Asa Sul fica em SCLS 404 Bloco C, Asa Sul, Brasília/DF.' },
      { tipo: 'localizacao', to: '5561999998888', corpo: { lat: -15.8136, lng: -47.896, nome: 'Asa Sul', endereco: 'SCLS 404 Bloco C, Asa Sul, Brasília/DF' } },
    ])
    const saidas = await db.select({ tipo: schema.messages.tipo, replyKey: schema.messages.replyKey }).from(schema.messages)
      .where(eq(schema.messages.direcao, 'out')).orderBy(asc(schema.messages.id))
    expect(saidas.slice(1)).toEqual([{ tipo: 'texto', replyKey: 's1' }, { tipo: 'localizacao', replyKey: 's1' }])
  })

  it('mais de 3 unidades: lista + pendente; a escolha responde sem chamar o LLM', async () => {
    const { restaurantId, ids } = await setup(4)
    const conv = await receive(restaurantId, 'estão abertos agora?')
    const { llm, calls } = fakeLlm([{ itens: [h('aberto_agora')], fora_escopo: false }])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    const lista = wa.enviados.find((e) => e.tipo === 'lista')!
    expect((lista.corpo as { opcoes: { id: string }[] }).opcoes.map((o) => o.id)).toEqual([ids['Asa Sul'], ids['Asa Norte'], ids['Lago Sul'], ids['Águas Claras']])
    expect((await conversa(conv)).pendente).toMatchObject({ opcoes: expect.any(Array), itens: [h('aberto_agora')] })

    await receive(restaurantId, 'Asa Norte', ids['Asa Norte']!)
    await processConversation(deps(llm, wa), conv)
    expect(calls).toHaveLength(1)
    expect(wa.enviados.at(-1)!.corpo).toBe('A unidade Asa Norte está aberta agora e fecha às 23h.')
    expect((await conversa(conv)).pendente).toBeNull()
    const runs = await db.select().from(schema.aiRuns).orderBy(asc(schema.aiRuns.id))
    expect(runs.at(-1)).toMatchObject({ etapa: 'resposta', modelo: 'deterministico', promptVersion: 's1-lista', costUsd: '0.000000', itensValidos: 1, itensRespondidos: 1 })
  })

  it('escolha digitada (até 4 palavras) também vale', async () => {
    const { restaurantId } = await setup(4)
    const conv = await receive(restaurantId, 'estão abertos agora?')
    const { llm, calls } = fakeLlm([{ itens: [h('aberto_agora')], fora_escopo: false }])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    await receive(restaurantId, 'lago sul')
    await processConversation(deps(llm, wa), conv)
    expect(calls).toHaveLength(1)
    expect(wa.enviados.at(-1)!.corpo).toBe('A unidade Lago Sul está aberta agora e fecha às 23h.')
  })

  it('pendente vencido ou id fora das opções: segue a triagem normal', async () => {
    const { restaurantId } = await setup(4)
    const conv = await receive(restaurantId, 'estão abertos agora?')
    const { llm, calls } = fakeLlm([
      { itens: [h('aberto_agora')], fora_escopo: false },
      { itens: [h('lista_unidades')], fora_escopo: false },
    ])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    await receive(restaurantId, 'Outra', randomUUID())
    await processConversation(deps(llm, wa), conv)
    expect(calls).toHaveLength(2)
    await db.update(schema.conversations).set({ pendente: { itens: [h('aberto_agora')], opcoes: ['x'], expiraEm: '2026-10-05T16:00:00.000Z' } })
    await receive(restaurantId, 'Asa Sul')
    await processConversation(deps(llm, wa), conv)
    expect(calls).toHaveLength(3)
  })

  it('pergunta sem dado vira lacuna mascarada; repetir soma; simulação não registra', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'tem área kids? meu cel (61) 99999-8888')
    const { llm } = fakeLlm([{ itens: [h('info', { tema: 'area kids' })], fora_escopo: false }])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    expect(wa.enviados.at(-1)!.corpo).toBe('Ainda não tenho essa informação; vou verificar com a equipe.')
    await receive(restaurantId, 'e área kids, tem?')
    await processConversation(deps(llm, wa), conv)
    const [gap] = await db.select().from(schema.knowledgeGaps)
    expect(gap).toMatchObject({ chaveNormalizada: 'info:area kids', ocorrencias: 2, unitId: null })
    expect(gap!.perguntaMascarada).not.toContain('99999')

    await db.update(schema.conversations).set({ simulada: true })
    await receive(restaurantId, 'tem tomada?')
    const sim = fakeLlm([{ itens: [h('info', { tema: 'tomada' })], fora_escopo: false }])
    await processConversation(deps(sim.llm, wa), conv)
    expect(await db.select().from(schema.knowledgeGaps)).toHaveLength(1)
    const runs = await db.select().from(schema.aiRuns).orderBy(asc(schema.aiRuns.id))
    expect(runs.at(-1)!.simulado).toBe(true)
  })

  it('item humano em qualquer posição ⇒ handoff', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'abre domingo? quero reclamar')
    const { llm } = fakeLlm([{ itens: [h('horario_dia', { data: 'domingo' }), { servico: 'humano', tipo: null, unidade: null, data: null, tema: null }], fora_escopo: false }])
    await processConversation(deps(llm, fakeWa()), conv)
    expect((await conversa(conv)).estado).toBe('aguardando_humano')
  })

  it('só fora de escopo ⇒ resposta fixa de fora de escopo', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'quem ganhou o jogo?')
    const { llm } = fakeLlm([{ itens: [], fora_escopo: true }])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    expect(wa.enviados.at(-1)!.corpo).toContain('só consigo ajudar com assuntos do Casa Teste')
  })
})
