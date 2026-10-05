import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import type { PgBoss } from 'pg-boss'
import { encryptPhone, keyFromBase64 } from '@atd/core'
import { applyStatus, createBoss, createDb, enqueueProcess, ingestInbound, schema } from '@atd/db'
import { getTestBoss, getTestDb, resetDb, seedRestaurant, setupPgbossRoles, WEB_URL, WORKER_URL } from '@atd/db/test-utils'
import type { LlmClient } from '@atd/ai'
import type { SendResult } from '@atd/whatsapp'
import { createLogger } from '../logger.ts'
import { processConversation, type ProcessDeps } from './process-conversation.ts'

/**
 * Regressão de grants: o caminho de runtime roda com os roles de produção (web_app no webhook,
 * worker_app no job), não com o postgres. O admin só semeia e limpa.
 */
const admin = getTestDb()
let web: ReturnType<typeof createDb>
let worker: ReturnType<typeof createDb>
let webBoss: PgBoss

const phoneKey = keyFromBase64(Buffer.alloc(32, 6).toString('base64'))
const log = createLogger('silent')

beforeAll(async () => {
  await setupPgbossRoles() // define as senhas locais web_dev/worker_dev e o dono do schema pgboss
  await getTestBoss() // filas criadas pelo worker_app
  web = createDb(WEB_URL, { max: 2 })
  worker = createDb(WORKER_URL, { max: 4 })
  webBoss = createBoss(WEB_URL, 'web')
  await webBoss.start()
})
beforeEach(() => resetDb(admin.sql))
afterAll(async () => {
  await webBoss.stop({ graceful: false })
  await (await getTestBoss()).stop({ graceful: false })
  await Promise.all([web.sql.end(), worker.sql.end(), admin.sql.end()])
})

async function seed() {
  const { restaurantId } = await seedRestaurant(admin.db)
  await admin.db.update(schema.restaurants).set({ nome: 'Casa Teste', politicaUrl: 'https://casa.test/privacidade' })
  await admin.db.insert(schema.budgetLimits).values([
    { restaurantId, escopo: 'ia', periodo: 'dia', limiteUsd: '1' },
    { restaurantId, escopo: 'ia', periodo: 'mes', limiteUsd: '10' },
  ])
  return restaurantId
}

/** Como o webhook em produção: conexão web_app e enqueue do pg-boss na mesma transação. */
async function receiveAsWeb(restaurantId: string, texto: string, waIdHash = 'hash-maria') {
  const wamid = `wamid.${randomUUID()}`
  const r = await ingestInbound(
    web.db,
    {
      restaurantId, waIdHash, telefoneCifrado: encryptPhone('5561999998888', phoneKey),
      profileName: 'Maria', timestamp: new Date(), wamid, tipo: 'texto', texto, mediaId: null,
    },
    enqueueProcess(webBoss),
  )
  expect(r.inserted).toBe(true)
  return { conversationId: r.conversationId, wamid }
}

function fakeLlm(step: { intent: string; confianca: number } | 'erro') {
  let calls = 0
  const llm: LlmClient = {
    async completeJson(p) {
      calls++
      if (step === 'erro') {
        return { ok: false as const, error: 'upstream', retryable: true, status: 502, model: null, usage: null, latencyMs: 1 }
      }
      return {
        ok: true as const, data: p.parse(step), model: 'fake/m',
        usage: { tokensIn: 100, tokensOut: 5, tokensCache: 0, costUsd: '0.000200' }, latencyMs: 10,
      }
    },
  }
  return { llm, calls: () => calls }
}

function fakeWa() {
  const sent: string[] = []
  return {
    sent,
    async sendText(_to: string, text: string): Promise<SendResult> {
      sent.push(text)
      return { ok: true, wamid: `wamid.out.${randomUUID()}` }
    },
  }
}

const depsAsWorker = (llm: LlmClient, wa: ReturnType<typeof fakeWa>): ProcessDeps => ({
  db: worker.db, llm, wa, phoneKey, triageModels: ['fake/m'], log, requeue: async () => undefined,
})

describe('grants de runtime (web_app → worker_app)', () => {
  it('web_app ingere e enfileira; worker_app responde com aviso, triagem paga e custo', async () => {
    expect((await web.sql`select current_user as u`)[0]!.u).toBe('web_app')
    expect((await worker.sql`select current_user as u`)[0]!.u).toBe('worker_app')
    const rid = await seed()
    const { conversationId } = await receiveAsWeb(rid, 'oi')
    const [job] = await admin.sql`select data->>'conversationId' as c from pgboss.job where name = 'conversation.process'`
    expect(job?.c).toBe(conversationId)

    const wa = fakeWa()
    expect(await processConversation(depsAsWorker(fakeLlm({ intent: 'fora_escopo', confianca: 0.9 }).llm, wa), conversationId)).toBe('replied')
    expect(wa.sent).toHaveLength(2) // aviso de privacidade + saudação

    await receiveAsWeb(rid, 'como está o tempo hoje?')
    const llm = fakeLlm({ intent: 'fora_escopo', confianca: 0.97 })
    expect(await processConversation(depsAsWorker(llm.llm, wa), conversationId)).toBe('replied')
    expect(llm.calls()).toBe(1)
    expect((await admin.db.select().from(schema.aiRuns)).map((r) => r.intent)).toEqual(['fora_escopo'])
    const counters = await admin.db.select().from(schema.budgetCounters)
    expect(counters.map((c) => c.gasto)).toEqual(['0.000200', '0.000200'])

    // status de entrega aplicado pelo webhook (web_app) na mensagem enviada pelo worker
    const [out] = await admin.db.select().from(schema.messages).where(eq(schema.messages.direcao, 'out')).limit(1)
    await applyStatus(web.db, { wamid: out!.wamid!, status: 'read', errorCode: null })
    const [after] = await admin.db.select().from(schema.messages).where(eq(schema.messages.id, out!.id))
    expect(after!.statusEnvio).toBe('read')
  })

  it('worker_app faz handoff auditado e registra pedido LGPD', async () => {
    const rid = await seed()
    const a = await receiveAsWeb(rid, 'quero falar com atendente', 'hash-a')
    await processConversation(depsAsWorker(fakeLlm('erro').llm, fakeWa()), a.conversationId)
    const b = await receiveAsWeb(rid, 'quero apagar meus dados', 'hash-b')
    await processConversation(depsAsWorker(fakeLlm('erro').llm, fakeWa()), b.conversationId)

    const convs = await admin.db.select().from(schema.conversations).where(eq(schema.conversations.id, a.conversationId))
    expect(convs[0]!.estado).toBe('aguardando_humano')
    expect((await admin.db.select().from(schema.auditLog)).map((x) => x.acao)).toContain('conversa.handoff_pedido')
    const [dsr] = await admin.db.select().from(schema.dataSubjectRequests)
    expect(dsr!.tipo).toBe('exclusao')
  })

  it('worker_app: LLM falha, reserva devolvida e handoff com resposta fixa', async () => {
    const rid = await seed()
    const { conversationId } = await receiveAsWeb(rid, 'qual o endereço?')
    const wa = fakeWa()
    const llm = fakeLlm('erro')
    await processConversation(depsAsWorker(llm.llm, wa), conversationId)
    expect(llm.calls()).toBe(2)
    expect(wa.sent.at(-1)).toMatch(/Tive um problema/)
    const [c] = await admin.db.select().from(schema.conversations)
    expect(c!.estado).toBe('aguardando_humano')
    expect((await admin.db.select().from(schema.aiRuns)).map((r) => r.resultado)).toEqual(['erro', 'erro'])
  })
})
