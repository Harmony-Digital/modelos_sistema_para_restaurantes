import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { encryptPhone, keyFromBase64 } from '@atd/core'
import { ingestInbound, schema, type Enqueue } from '@atd/db'
import { getTestDb, resetDb, seedRestaurant } from '@atd/db/test-utils'
import type * as CoreModule from '@atd/core'
import type { LlmClient } from '@atd/ai'
import { createLogger } from '../logger.ts'
import { comMidiaProibida, storageProibido } from './midia-fake.ts'
import { processConversation, type ProcessDeps } from './process-conversation.ts'
import { comoV7 } from './triagem-falsa.ts'

vi.mock('@atd/core', async (importOriginal) => {
  const orig = await importOriginal<typeof CoreModule>()
  return {
    ...orig,
    resolverAtendimento: () => {
      throw new Error('falha simulada')
    },
  }
})

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const phoneKey = keyFromBase64(Buffer.alloc(32, 7).toString('base64'))
const noopEnqueue: Enqueue = async () => undefined

describe('S1 no worker: falha ao resolver depois da triagem paga', () => {
  it('propaga o erro, devolve a reserva e contabiliza o gasto', async () => {
    const { restaurantId } = await seedRestaurant(db)
    await db.insert(schema.budgetLimits).values([
      { restaurantId, escopo: 'ia', periodo: 'dia', limiteUsd: '1' },
      { restaurantId, escopo: 'ia', periodo: 'mes', limiteUsd: '10' },
    ])
    const r = await ingestInbound(db, {
      restaurantId, waIdHash: 'hash-maria', telefoneCifrado: encryptPhone('5561999998888', phoneKey), profileName: 'Maria',
      timestamp: new Date(), wamid: `wamid.${randomUUID()}`, tipo: 'texto', texto: 'abre domingo?', mediaId: null, interativoId: null,
    }, noopEnqueue)
    const llm: LlmClient = {
      async completeJson(p) {
        return {
          ok: true as const,
          data: p.parse(comoV7({ itens: [{ servico: 'horario_unidades', tipo: 'horario_dia', unidade: null, data: 'domingo', tema: null, pessoas: null, horario: null, convidados: null, tipoEvento: null, espaco: null, consulta: null, tag: null }], fora_escopo: false })),
          model: 'fake/m', usage: { tokensIn: 100, tokensOut: 20, tokensCache: 0, costUsd: '0.000200' }, latencyMs: 10,
        }
      },
    }
    const wa = { sendText: vi.fn(), sendLocation: vi.fn(), sendList: vi.fn() }
    const d: ProcessDeps = {
      db, llm, wa: comMidiaProibida(wa), storage: storageProibido, phoneKey, triageModels: ['fake/m'], log: createLogger('silent'), requeue: async () => undefined,
      now: () => new Date('2026-10-05T14:00:00-03:00'),
    }
    await expect(processConversation(d, r.conversationId)).rejects.toThrow(/falha simulada/)
    const counters = await db.select().from(schema.budgetCounters)
    expect(counters.length).toBeGreaterThan(0)
    expect(counters.map((c) => [c.reservado, c.gasto])).toEqual(counters.map(() => ['0.000000', '0.000200']))
  })
})
