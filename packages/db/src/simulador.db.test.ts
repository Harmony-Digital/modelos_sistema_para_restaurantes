import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { asc } from 'drizzle-orm'
import { createDb } from './client.ts'
import { getTestDb, resetDb, seedRestaurant, seedStaff, setupPgbossRoles, WEB_URL } from './test-utils.ts'
import { conversations, customers, messages } from './schema/conversation.ts'
import { aiRuns } from './schema/ops.ts'
import type { Enqueue } from './queue.ts'
import {
  abrirSimulacao, definirRelogioSimulado, detalhesSimulacao, enviarMensagemSimulada, mensagensSimuladas, novoClienteSimulado,
  TELEFONE_SIMULADO,
} from './simulador.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const enfileirados: string[] = []
const enqueue: Enqueue = async (_tx, id) => { enfileirados.push(id) }
const claims = (sub: string) => ({ sub, role: 'authenticated' as const, aal: 'aal2' as const })

async function setup() {
  const { restaurantId } = await seedRestaurant(db)
  const dono = await seedStaff(db, sql, { restaurantId, papel: 'dono' })
  const gerente = await seedStaff(db, sql, { restaurantId, papel: 'gerente' })
  return { restaurantId, dono, gerente }
}

describe('simulador (banco)', () => {
  it('abrir cria cliente e conversa simulados do usuário; abrir de novo devolve a mesma', async () => {
    const { restaurantId, dono } = await setup()
    const a = await abrirSimulacao(db, { restaurantId, userId: dono })
    const b = await abrirSimulacao(db, { restaurantId, userId: dono })
    expect(b.conversationId).toBe(a.conversationId)
    const [c] = await db.select().from(customers)
    expect(c).toMatchObject({ simulado: true, telefoneCifrado: TELEFONE_SIMULADO, nomePerfil: 'Cliente simulado' })
    expect(c!.waIdHash).toMatch(new RegExp(`^sim:${dono}:\\d+$`))
    const [conv] = await db.select().from(conversations)
    expect(conv).toMatchObject({ simulada: true, estado: 'ia', relogioOffsetSegundos: null })
  })

  it('abrir duas vezes ao mesmo tempo cria uma conversa só', async () => {
    const { restaurantId, dono } = await setup()
    const [a, b] = await Promise.all([abrirSimulacao(db, { restaurantId, userId: dono }), abrirSimulacao(db, { restaurantId, userId: dono })])
    expect(a.conversationId).toBe(b.conversationId)
    expect(await db.select().from(customers)).toHaveLength(1)
  })

  it('novo cliente encerra a conversa anterior e mantém o relógio simulado', async () => {
    const { restaurantId, dono } = await setup()
    const p = { restaurantId, userId: dono }
    const a = await abrirSimulacao(db, p)
    expect(await definirRelogioSimulado(db, { ...p, conversationId: a.conversationId, offsetSegundos: 3600 })).toBe('ok')
    const b = await novoClienteSimulado(db, p)
    expect(b.conversationId).not.toBe(a.conversationId)
    const convs = await db.select().from(conversations).orderBy(asc(conversations.createdAt))
    expect(convs.map((c) => [c.id, c.estado, c.relogioOffsetSegundos])).toEqual([
      [a.conversationId, 'encerrada', 3600],
      [b.conversationId, 'ia', 3600],
    ])
    expect(await db.select().from(customers)).toHaveLength(2)
    expect((await abrirSimulacao(db, p)).conversationId).toBe(b.conversationId)
  })

  it('enviar grava a mensagem como simulada (wamid sim.*) e enfileira o mesmo job do webhook', async () => {
    const { restaurantId, dono } = await setup()
    const p = { restaurantId, userId: dono }
    const { conversationId } = await abrirSimulacao(db, p)
    enfileirados.length = 0
    expect(await enviarMensagemSimulada(db, { ...p, conversationId, texto: 'abre domingo?' }, enqueue)).toBe('ok')
    expect(enfileirados).toEqual([conversationId])
    const [m] = await db.select().from(messages)
    expect(m).toMatchObject({ conversationId, direcao: 'in', autor: 'cliente', tipo: 'texto', texto: 'abre domingo?' })
    expect(m!.wamid).toMatch(/^sim\./)
  })

  it('outro usuário não envia, não lê, não muda o relógio nem vê detalhes da simulação alheia', async () => {
    const { restaurantId, dono, gerente } = await setup()
    const { conversationId } = await abrirSimulacao(db, { restaurantId, userId: dono })
    const alheio = { restaurantId, userId: gerente, conversationId }
    expect(await enviarMensagemSimulada(db, { ...alheio, texto: 'oi' }, enqueue)).toBe('nao_encontrada')
    expect(await mensagensSimuladas(db, { ...alheio, desdeId: 0 })).toBeNull()
    expect(await definirRelogioSimulado(db, { ...alheio, offsetSegundos: 60 })).toBe('nao_encontrada')
    expect(await detalhesSimulacao(db, claims(gerente), alheio)).toBeNull()
  })

  it('conversa real nunca é tratada como simulação, mesmo com o id certo', async () => {
    const { restaurantId, dono } = await setup()
    const [c] = await db.insert(customers).values({ restaurantId, waIdHash: `sim:${dono}:1`, telefoneCifrado: 'x' }).returning()
    const [conv] = await db.insert(conversations).values({ restaurantId, customerId: c!.id }).returning()
    expect(await mensagensSimuladas(db, { restaurantId, userId: dono, conversationId: conv!.id, desdeId: 0 })).toBeNull()
  })

  it('conversa encerrada não recebe mensagem', async () => {
    const { restaurantId, dono } = await setup()
    const p = { restaurantId, userId: dono }
    const a = await abrirSimulacao(db, p)
    await novoClienteSimulado(db, p)
    expect(await enviarMensagemSimulada(db, { ...p, conversationId: a.conversationId, texto: 'oi' }, enqueue)).toBe('encerrada')
  })

  it('mensagens: mostra recebidas e saídas "simulado"; esconde pendentes e canceladas; cursor volta para a primeira pendente', async () => {
    const { restaurantId, dono } = await setup()
    const p = { restaurantId, userId: dono }
    const { conversationId } = await abrirSimulacao(db, p)
    await enviarMensagemSimulada(db, { ...p, conversationId, texto: 'oi' }, enqueue)
    const base = { restaurantId, conversationId, direcao: 'out' as const, autor: 'ia' as const, tipo: 'texto' as const }
    const [entregue] = await db.insert(messages).values({ ...base, texto: 'entregue', statusEnvio: 'simulado' }).returning()
    const [pendente] = await db.insert(messages).values({ ...base, texto: 'pendente', statusEnvio: 'pendente' }).returning()
    await db.insert(messages).values({ ...base, texto: 'cancelada', statusEnvio: 'cancelado' })
    const r = await mensagensSimuladas(db, { ...p, conversationId, desdeId: 0 })
    expect(r!.mensagens.map((m) => m.texto)).toEqual(['oi', 'entregue'])
    expect(r!.cursor).toBe(pendente!.id - 1)
    expect(r!.digitando).toBe(true) // há entrada não processada e saída pendente
    const depois = await mensagensSimuladas(db, { ...p, conversationId, desdeId: entregue!.id })
    expect(depois!.mensagens).toEqual([])
  })

  it('relógio: aceita deslocamento e volta ao real com null', async () => {
    const { restaurantId, dono } = await setup()
    const p = { restaurantId, userId: dono }
    const { conversationId } = await abrirSimulacao(db, p)
    await definirRelogioSimulado(db, { ...p, conversationId, offsetSegundos: -86_400 })
    expect((await mensagensSimuladas(db, { ...p, conversationId, desdeId: 0 }))!.relogioOffsetSegundos).toBe(-86_400)
    await definirRelogioSimulado(db, { ...p, conversationId, offsetSegundos: null })
    expect((await mensagensSimuladas(db, { ...p, conversationId, desdeId: 0 }))!.relogioOffsetSegundos).toBeNull()
  })

  it('detalhes: últimas execuções da IA desta conversa, mais recentes primeiro (só dono/gerente pela RLS)', async () => {
    const { restaurantId, dono } = await setup()
    const p = { restaurantId, userId: dono }
    const { conversationId } = await abrirSimulacao(db, p)
    for (const intent of ['a', 'b']) {
      await db.insert(aiRuns).values({ restaurantId, conversationId, etapa: 'triagem', modelo: 'm', promptVersion: 'v', costUsd: '0.0001', intent, resultado: 'ok', simulado: true })
    }
    const d = await detalhesSimulacao(db, claims(dono), { ...p, conversationId })
    expect(d!.map((x) => x.intent)).toEqual(['b', 'a'])
  })

  it('fidelidade de produção: tudo funciona conectado como web_app', async () => {
    await setupPgbossRoles()
    const { restaurantId, dono } = await setup()
    const web = createDb(WEB_URL, { max: 1 })
    try {
      const p = { restaurantId, userId: dono }
      const { conversationId } = await abrirSimulacao(web.db, p)
      expect(await enviarMensagemSimulada(web.db, { ...p, conversationId, texto: 'oi' }, enqueue)).toBe('ok')
      expect(await definirRelogioSimulado(web.db, { ...p, conversationId, offsetSegundos: 60 })).toBe('ok')
      expect((await mensagensSimuladas(web.db, { ...p, conversationId, desdeId: 0 }))!.mensagens).toHaveLength(1)
      await novoClienteSimulado(web.db, p)
    } finally {
      await web.sql.end()
    }
  })
})
