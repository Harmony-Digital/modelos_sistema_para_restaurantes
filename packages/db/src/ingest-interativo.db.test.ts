import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { getTestDb, resetDb, seedRestaurant } from './test-utils.ts'
import { ingestInbound } from './ingest.ts'
import { messages } from './schema/index.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

describe('ingestão de resposta de lista', () => {
  it('grava o id escolhido em messages.payload', async () => {
    const { restaurantId } = await seedRestaurant(db)
    await ingestInbound(db, {
      restaurantId, waIdHash: 'h', telefoneCifrado: 'x', profileName: null, wamid: 'wamid.in.lista',
      tipo: 'texto', texto: 'Asa Norte', mediaId: null, timestamp: new Date(), interativoId: 'u-asa-norte',
    }, async () => undefined)
    const [m] = await db.select().from(messages).where(eq(messages.wamid, 'wamid.in.lista'))
    expect(m!.payload).toEqual({ interativoId: 'u-asa-norte' })
  })
})
