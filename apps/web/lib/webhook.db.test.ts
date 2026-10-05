import { createHmac } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PgBoss } from 'pg-boss'
import { decryptPhone, keyFromBase64 } from '@atd/core'
import { enqueueProcess, schema } from '@atd/db'
import { getTestBoss, getTestDb, resetDb, seedRestaurant } from '@atd/db/test-utils'
import text from '@atd/whatsapp/fixtures/text.json' with { type: 'json' }
import status from '@atd/whatsapp/fixtures/status.json' with { type: 'json' }
import { handleWebhookPost, type WebhookDeps } from './webhook.ts'

const { db, sql } = getTestDb()
const secret = 'app-secret'
const phoneKey = keyFromBase64(Buffer.alloc(32, 3).toString('base64'))
const pepper = keyFromBase64(Buffer.alloc(32, 4).toString('base64'))
let boss: PgBoss
let deps: WebhookDeps

beforeAll(async () => { boss = await getTestBoss() })
beforeEach(async () => {
  await resetDb(sql)
  const { restaurantId } = await seedRestaurant(db)
  deps = { db, enqueue: enqueueProcess(boss), appSecret: secret, phoneNumberId: '111', phoneKey, pepper, restaurantId: async () => restaurantId }
})
afterAll(async () => { await boss.stop({ graceful: false }); await sql.end() })

const sign = (raw: string) => `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`

describe('webhook POST', () => {
  it('assinatura válida: grava mensagem com telefone cifrado e hash', async () => {
    const raw = JSON.stringify(text)
    expect(await handleWebhookPost(deps, raw, sign(raw))).toEqual({ status: 200, body: 'ok' })
    const [c] = await db.select().from(schema.customers)
    expect(c!.waIdHash).toMatch(/^[0-9a-f]{64}$/)
    expect(c!.telefoneCifrado).not.toContain('5561999998888')
    expect(decryptPhone(c!.telefoneCifrado, phoneKey)).toBe('5561999998888')
    const [m] = await db.select().from(schema.messages)
    expect([m!.wamid, m!.texto]).toEqual(['wamid.TEXT1', 'Vocês abrem domingo?'])
  })

  it('assinatura inválida: 401 e nada gravado (I7)', async () => {
    const raw = JSON.stringify(text)
    expect((await handleWebhookPost(deps, raw, 'sha256=00')).status).toBe(401)
    expect(await db.select().from(schema.messages)).toHaveLength(0)
    expect(await db.select().from(schema.customers)).toHaveLength(0)
  })

  it('payload desconhecido com assinatura válida: 200 e ignorado', async () => {
    const raw = JSON.stringify({ hello: 'world' })
    let reported = false
    const r = await handleWebhookPost({ ...deps, onInvalidPayload: () => { reported = true } }, raw, sign(raw))
    expect(r.status).toBe(200)
    expect(reported).toBe(true)
  })

  it('payload acima de 1 MB: 413', async () => {
    const raw = 'x'.repeat(1_000_001)
    expect((await handleWebhookPost(deps, raw, sign(raw))).status).toBe(413)
  })

  it('status de entrega é aplicado', async () => {
    const raw = JSON.stringify(status)
    expect((await handleWebhookPost(deps, raw, sign(raw))).status).toBe(200)
  })
})
