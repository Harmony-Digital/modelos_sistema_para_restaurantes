import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getTestDb, resetDb, seedRestaurant } from './test-utils.ts'
import { conversations, customers, messages } from './schema/conversation.ts'
import { eq } from 'drizzle-orm'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

async function seedCustomer(restaurantId: string) {
  const [c] = await db
    .insert(customers)
    .values({ restaurantId, waIdHash: 'hash-1', telefoneCifrado: 'cifrado' })
    .returning()
  return c!
}

describe('conversas', () => {
  it('wamid é único (idempotência do webhook)', async () => {
    const { restaurantId } = await seedRestaurant(db)
    const c = await seedCustomer(restaurantId)
    const [conv] = await db.insert(conversations).values({ restaurantId, customerId: c.id }).returning()
    const msg = { restaurantId, conversationId: conv!.id, direcao: 'in', autor: 'cliente', tipo: 'texto', wamid: 'wamid.X', texto: 'oi' } as const
    await db.insert(messages).values(msg)
    await expect(db.insert(messages).values(msg)).rejects.toMatchObject({
      cause: { code: '23505', constraint_name: 'messages_wamid_uq' },
    })
  })

  it('no máximo uma conversa aberta por cliente; encerrada libera nova', async () => {
    const { restaurantId } = await seedRestaurant(db)
    const c = await seedCustomer(restaurantId)
    const [first] = await db.insert(conversations).values({ restaurantId, customerId: c.id }).returning()
    await expect(db.insert(conversations).values({ restaurantId, customerId: c.id })).rejects.toMatchObject({
      cause: { code: '23505', constraint_name: 'conversations_one_open_per_customer_uq' },
    })
    await db.update(conversations).set({ estado: 'encerrada' }).where(eq(conversations.id, first!.id))
    await expect(db.insert(conversations).values({ restaurantId, customerId: c.id })).resolves.toBeDefined()
  })

  it('wa_id_hash é único por restaurante', async () => {
    const { restaurantId } = await seedRestaurant(db)
    await seedCustomer(restaurantId)
    await expect(seedCustomer(restaurantId)).rejects.toMatchObject({
      cause: { code: '23505', constraint_name: 'customers_restaurant_wa_id_hash_uq' },
    })
  })
})
