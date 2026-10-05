import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import type { PgBoss } from 'pg-boss'
import { getTestBoss, getTestDb, resetDb, seedRestaurant } from './test-utils.ts'
import { applyStatus, ingestInbound, type IngestInput } from './ingest.ts'
import { createBoss, enqueueProcess, QUEUES } from './queue.ts'
import { conversations, customers, messages } from './schema/conversation.ts'

const { db, sql } = getTestDb()
let boss: PgBoss
beforeAll(async () => { boss = await getTestBoss() })
beforeEach(() => resetDb(sql))
afterAll(async () => { await boss.stop({ graceful: false }); await sql.end() })

const jobs = () => sql<{ singleton_key: string; secs: number }[]>`
  select singleton_key, extract(epoch from start_after - now())::int as secs
    from pgboss.job where name = ${QUEUES.process}`

function input(restaurantId: string, over: Partial<IngestInput> = {}): IngestInput {
  return {
    restaurantId, waIdHash: 'hash-maria', telefoneCifrado: 'v1.cifra', profileName: 'Maria',
    wamid: 'wamid.1', tipo: 'texto', texto: 'oi', mediaId: null, ...over,
  }
}

describe('ingestInbound', () => {
  it('cliente novo: cria cliente, conversa, mensagem e UM job atrasado 4s', async () => {
    const { restaurantId } = await seedRestaurant(db)
    const r = await ingestInbound(db, input(restaurantId), enqueueProcess(boss))
    expect(r.inserted).toBe(true)
    expect(await db.select().from(customers)).toHaveLength(1)
    const [conv] = await db.select().from(conversations)
    expect(conv!.id).toBe(r.conversationId)
    expect(conv!.windowExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000)
    const js = await jobs()
    expect(js).toHaveLength(1)
    expect(js[0]!.singleton_key).toBe(r.conversationId)
    expect(js[0]!.secs).toBeGreaterThanOrEqual(2)
  })

  it('reentrega sequencial do mesmo wamid não duplica', async () => {
    const { restaurantId } = await seedRestaurant(db)
    await ingestInbound(db, input(restaurantId), enqueueProcess(boss))
    const again = await ingestInbound(db, input(restaurantId), enqueueProcess(boss))
    expect(again.inserted).toBe(false)
    expect(await db.select().from(messages)).toHaveLength(1)
    expect(await jobs()).toHaveLength(1)
  })

  it('reentrega concorrente (5x em paralelo) gera 1 mensagem e 1 job', async () => {
    const { restaurantId } = await seedRestaurant(db)
    const rs = await Promise.all(Array.from({ length: 5 }, () => ingestInbound(db, input(restaurantId), enqueueProcess(boss))))
    expect(rs.filter((r) => r.inserted)).toHaveLength(1)
    expect(await db.select().from(messages)).toHaveLength(1)
    expect(await db.select().from(conversations)).toHaveLength(1)
    expect(await jobs()).toHaveLength(1)
  })

  it('rajada de 3 mensagens diferentes: 3 mensagens, 1 job enfileirado', async () => {
    const { restaurantId } = await seedRestaurant(db)
    for (const [i, texto] of ['oi', 'queria saber', 'abre domingo?'].entries()) {
      await ingestInbound(db, input(restaurantId, { wamid: `wamid.${i}`, texto }), enqueueProcess(boss))
    }
    expect(await db.select().from(messages)).toHaveLength(3)
    expect(await jobs()).toHaveLength(1)
  })

  it('atualiza nome do perfil sem sobrescrever a cifra do telefone', async () => {
    const { restaurantId } = await seedRestaurant(db)
    await ingestInbound(db, input(restaurantId), enqueueProcess(boss))
    await ingestInbound(db, input(restaurantId, { wamid: 'wamid.2', profileName: 'Maria S.', telefoneCifrado: 'v1.outra' }), enqueueProcess(boss))
    const [c] = await db.select().from(customers)
    expect([c!.nomePerfil, c!.telefoneCifrado]).toEqual(['Maria S.', 'v1.cifra'])
  })

  it('conversa encerrada: nova mensagem abre outra conversa', async () => {
    const { restaurantId } = await seedRestaurant(db)
    const first = await ingestInbound(db, input(restaurantId), enqueueProcess(boss))
    await db.update(conversations).set({ estado: 'encerrada' }).where(eq(conversations.id, first.conversationId))
    const second = await ingestInbound(db, input(restaurantId, { wamid: 'wamid.2' }), enqueueProcess(boss))
    expect(second.conversationId).not.toBe(first.conversationId)
  })

  it('boss "web" (sem migrate/supervise) consegue enfileirar', async () => {
    const { restaurantId } = await seedRestaurant(db)
    const webBoss = createBoss(process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', 'web')
    await webBoss.start()
    await ingestInbound(db, input(restaurantId), enqueueProcess(webBoss))
    expect(await jobs()).toHaveLength(1)
    await webBoss.stop({ graceful: false })
  })
})

describe('applyStatus', () => {
  it('grava status de entrega pelo wamid', async () => {
    const { restaurantId } = await seedRestaurant(db)
    await ingestInbound(db, input(restaurantId, { wamid: 'wamid.OUT' }), enqueueProcess(boss))
    await applyStatus(db, { wamid: 'wamid.OUT', status: 'failed', errorCode: 131047 })
    const [m] = await db.select().from(messages)
    expect(m!.statusEnvio).toBe('failed:131047')
  })
})
