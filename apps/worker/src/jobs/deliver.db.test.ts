import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import { encryptPhone, keyFromBase64 } from '@atd/core'
import { abrirSimulacao, ingestInbound, schema, type Enqueue } from '@atd/db'
import { getTestDb, resetDb, seedRestaurant, seedStaff } from '@atd/db/test-utils'
import type { SendResult } from '@atd/whatsapp'
import { createLogger } from '../logger.ts'
import { deliver, type DeliverDeps } from './deliver.ts'
import { comMidiaProibida, storageProibido } from './midia-fake.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const phoneKey = keyFromBase64(Buffer.alloc(32, 4).toString('base64'))
const noopEnqueue: Enqueue = async () => undefined
const log = createLogger('silent')

function fakeWa(resultado?: () => SendResult, atraso = 0) {
  const enviados: { to: string; texto: string }[] = []
  return {
    enviados,
    async sendText(to: string, texto: string): Promise<SendResult> {
      if (atraso) await new Promise((r) => setTimeout(r, atraso))
      enviados.push({ to, texto })
      return resultado?.() ?? { ok: true, wamid: `wamid.out.${randomUUID()}` }
    },
    async sendLocation(): Promise<never> { throw new Error('não esperado') },
    async sendList(): Promise<never> { throw new Error('não esperado') },
  }
}

const deps = (wa: ReturnType<typeof fakeWa>): DeliverDeps => ({ db, wa: comMidiaProibida(wa), storage: storageProibido, phoneKey, log })

async function conversaReal() {
  const { restaurantId } = await seedRestaurant(db)
  const atendente = await seedStaff(db, sql, { restaurantId, papel: 'atendente' })
  const r = await ingestInbound(db, {
    restaurantId, waIdHash: 'hash-maria', telefoneCifrado: encryptPhone('5561999998888', phoneKey), profileName: 'Maria',
    timestamp: new Date(), wamid: `wamid.${randomUUID()}`, tipo: 'texto', texto: 'oi', mediaId: null,
  }, noopEnqueue)
  await db.update(schema.conversations).set({ estado: 'humano', atendenteId: atendente }).where(eq(schema.conversations.id, r.conversationId))
  return { restaurantId, conversationId: r.conversationId, atendente }
}

type Nova = { restaurantId: string; conversationId: string; autor: 'ia' | 'humano' | 'sistema'; texto: string; atendente?: string }
async function pendente(m: Nova) {
  const [row] = await db.insert(schema.messages).values({
    restaurantId: m.restaurantId, conversationId: m.conversationId, direcao: 'out', autor: m.autor, tipo: 'texto', texto: m.texto,
    statusEnvio: 'pendente', atendenteId: m.autor === 'humano' ? (m.atendente ?? null) : null,
  }).returning()
  return row!
}

const saidas = (conversationId: string) => db.select().from(schema.messages)
  .where(eq(schema.messages.conversationId, conversationId)).orderBy(asc(schema.messages.id))
  .then((ms) => ms.filter((m) => m.direcao === 'out'))

describe('deliver: resposta humana', () => {
  it('entrega a resposta do atendente pela Meta (telefone decifrado) e grava o wamid', async () => {
    const c = await conversaReal()
    await pendente({ ...c, autor: 'humano', texto: 'Olá, Maria! Aqui é a Ana.' })
    const wa = fakeWa()
    await deliver(deps(wa), c.conversationId)
    expect(wa.enviados).toEqual([{ to: '5561999998888', texto: 'Olá, Maria! Aqui é a Ana.' }])
    const [m] = await saidas(c.conversationId)
    expect(m).toMatchObject({ autor: 'humano', atendenteId: c.atendente, statusEnvio: 'enviado' })
    expect(m!.wamid).toMatch(/^wamid\.out\./)
  })

  it('recusa permanente da Meta ⇒ falhou:<código>, sem lançar (o painel oferece "Tentar de novo")', async () => {
    const c = await conversaReal()
    await pendente({ ...c, autor: 'humano', texto: 'Oi!' })
    const wa = fakeWa(() => ({ ok: false, retryable: false, code: 131047, message: 'janela' }))
    await deliver(deps(wa), c.conversationId)
    expect((await saidas(c.conversationId))[0]!.statusEnvio).toBe('falhou:131047')
  })

  it('falha temporária ⇒ lança (o job retenta) e a mensagem continua pendente', async () => {
    const c = await conversaReal()
    await pendente({ ...c, autor: 'humano', texto: 'Oi!' })
    const wa = fakeWa(() => ({ ok: false, retryable: true, code: 130429, message: 'rate' }))
    await expect(deliver(deps(wa), c.conversationId)).rejects.toThrow(/temporária/)
    expect((await saidas(c.conversationId))[0]!.statusEnvio).toBe('pendente')
  })

  it('conversa simulada ⇒ simulado, sem chamar a Meta', async () => {
    const { restaurantId } = await seedRestaurant(db)
    const dono = await seedStaff(db, sql, { restaurantId, papel: 'dono' })
    const { conversationId } = await abrirSimulacao(db, { restaurantId, userId: dono })
    await db.update(schema.conversations).set({ estado: 'humano', atendenteId: dono }).where(eq(schema.conversations.id, conversationId))
    await pendente({ restaurantId, conversationId, autor: 'humano', texto: 'Resposta de teste', atendente: dono })
    const wa = fakeWa(() => { throw new Error('Meta chamada em simulação') })
    await deliver(deps(wa), conversationId)
    expect((await saidas(conversationId)).map((m) => m.statusEnvio)).toEqual(['simulado'])
  })

  it('I5: com humano no controle, a resposta pendente da IA é cancelada e a humana sai', async () => {
    const c = await conversaReal()
    await pendente({ ...c, autor: 'ia', texto: 'Abrimos às 11h.' })
    await pendente({ ...c, autor: 'sistema', texto: 'Vou passar você para alguém da nossa equipe.' })
    await pendente({ ...c, autor: 'humano', texto: 'Oi, Maria! Já te ajudo.' })
    const wa = fakeWa()
    await deliver(deps(wa), c.conversationId)
    expect((await saidas(c.conversationId)).map((m) => [m.autor, m.statusEnvio])).toEqual([
      ['ia', 'cancelado'], ['sistema', 'enviado'], ['humano', 'enviado'],
    ])
    expect(wa.enviados.map((e) => e.texto)).toEqual(['Vou passar você para alguém da nossa equipe.', 'Oi, Maria! Já te ajudo.'])
  })

  it('resposta humana sai mesmo se a conversa foi devolvida à IA depois de escrita', async () => {
    const c = await conversaReal()
    await pendente({ ...c, autor: 'humano', texto: 'Qualquer coisa, a IA continua.' })
    await db.update(schema.conversations).set({ estado: 'ia', atendenteId: null }).where(eq(schema.conversations.id, c.conversationId))
    const wa = fakeWa()
    await deliver(deps(wa), c.conversationId)
    expect((await saidas(c.conversationId))[0]!.statusEnvio).toBe('enviado')
  })

  it('duas entregas ao mesmo tempo (job de entrega + job da conversa) enviam cada mensagem uma vez só', async () => {
    const c = await conversaReal()
    await pendente({ ...c, autor: 'humano', texto: 'primeira' })
    await pendente({ ...c, autor: 'humano', texto: 'segunda' })
    const wa = fakeWa(undefined, 30)
    await Promise.all([deliver(deps(wa), c.conversationId), deliver(deps(wa), c.conversationId)])
    expect(wa.enviados.map((e) => e.texto)).toEqual(['primeira', 'segunda'])
    expect((await saidas(c.conversationId)).map((m) => m.statusEnvio)).toEqual(['enviado', 'enviado'])
  })

  it('nada pendente ⇒ não chama a Meta', async () => {
    const c = await conversaReal()
    const wa = fakeWa()
    await deliver(deps(wa), c.conversationId)
    expect(wa.enviados).toHaveLength(0)
  })
})
