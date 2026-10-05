import { createHmac } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { sql as dsql } from 'drizzle-orm'
import type { PgBoss } from 'pg-boss'
import { decryptPhone, encryptPhone, hashWaId, keyFromBase64 } from '@atd/core'
import { enqueueProcess, ingestInbound, schema } from '@atd/db'
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

const sign = (raw: string | Buffer) => `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`

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

  it('status de entrega é aplicado à mensagem', async () => {
    const waId = '5561999998888'
    await ingestInbound(
      db,
      {
        restaurantId: await deps.restaurantId(),
        waIdHash: hashWaId(waId, pepper),
        telefoneCifrado: encryptPhone(waId, phoneKey),
        profileName: null,
        wamid: 'wamid.OUT1',
        tipo: 'texto',
        texto: 'oi',
        mediaId: null,
        timestamp: new Date(),
      },
      deps.enqueue,
    )
    const [before] = await db.select().from(schema.messages)
    expect(before!.statusEnvio).toBeNull()
    const raw = JSON.stringify(status)
    expect((await handleWebhookPost(deps, raw, sign(raw))).status).toBe(200)
    const [after] = await db.select().from(schema.messages)
    expect(after!.statusEnvio).toBe('failed:131047')
  })

  it('aceita corpo como Buffer (bytes brutos)', async () => {
    const raw = Buffer.from(JSON.stringify(text), 'utf8')
    expect((await handleWebhookPost(deps, raw, sign(raw))).status).toBe(200)
  })
})

describe('webhook POST: falha ao gravar', () => {
  const nome = 'Maria Sigilosa Albuquerque'
  const corpo = 'Meu CPF é 529.982.247-25, fone 61 99999-8888'
  const payload = () => {
    const p = structuredClone(text)
    const v = p.entry[0]!.changes[0]!.value
    v.contacts[0]!.profile.name = nome
    v.messages[0]!.text.body = corpo
    return JSON.stringify(p)
  }
  let errorSpy: ReturnType<typeof vi.spyOn>
  let logSpy: ReturnType<typeof vi.spyOn>
  const printed = () =>
    [...errorSpy.mock.calls, ...logSpy.mock.calls].flat().map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : String(a))).join('\n')

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })
  afterEach(() => vi.restoreAllMocks())

  it('erro do banco na ingestão (FK): 500, Sentry recebe o erro e o console não vê params/PII', async () => {
    const raw = payload()
    const captured: unknown[] = []
    const r = await handleWebhookPost(
      { ...deps, restaurantId: async () => '00000000-0000-4000-8000-000000000000', onError: (e) => captured.push(e) },
      raw,
      sign(raw),
    )
    expect(r).toEqual({ status: 500, body: 'erro interno' })
    expect(captured).toHaveLength(1)
    expect(String((captured[0] as Error).message)).toContain('params:') // prova que o erro bruto tinha params
    const out = printed()
    expect(out).toContain('webhook: falha ao processar')
    expect(out).toContain('params: [redigido]')
    expect(out).not.toMatch(/params: (?!\[redigido\])/)
    expect(out).not.toContain(nome)
    expect(out).not.toContain('5561999998888')
    expect(out).not.toMatch(/[0-9a-f]{64}/) // hash do wa_id
    expect(out).not.toMatch(/v1\.[\w-]+\.[\w-]+\.[\w-]+/) // telefone cifrado
    expect(await db.select().from(schema.messages)).toHaveLength(0)
  })

  it('erro com o texto do cliente nos params: console só vê a mensagem redigida', async () => {
    const raw = payload()
    const r = await handleWebhookPost(
      { ...deps, enqueue: async (tx) => tx.execute(dsql`select ${corpo}::int`) },
      raw,
      sign(raw),
    )
    expect(r.status).toBe(500)
    const out = printed()
    expect(out).toContain('webhook: falha ao processar')
    expect(out).not.toContain(corpo)
    expect(out).not.toContain('529.982.247-25')
    expect(out).not.toContain('99999-8888')
    expect(out).not.toContain(nome)
    expect(await db.select().from(schema.messages)).toHaveLength(0) // rollback: Meta reentrega
  })
})
