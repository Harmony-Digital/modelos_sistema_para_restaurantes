import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getTestDb, resetDb, createAuthUser } from './test-utils.ts'
import { addStaff, bootstrapRestaurant, DEFAULT_RETENTION } from './bootstrap.ts'
import { budgetLimits, retentionSettings } from './schema/ops.ts'
import { restaurants, staff } from './schema/restaurant.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

describe('bootstrap', () => {
  it('é idempotente', async () => {
    const a = await bootstrapRestaurant(db, { nome: 'Casa X', politicaUrl: 'https://x/privacidade' })
    const b = await bootstrapRestaurant(db, { nome: 'Casa X' })
    expect(b).toBe(a)
    expect(await db.select().from(restaurants)).toHaveLength(1)
    expect(await db.select().from(budgetLimits)).toHaveLength(4)
    expect(await db.select().from(retentionSettings)).toHaveLength(DEFAULT_RETENTION.length)
  })

  it('addStaff não duplica', async () => {
    const rid = await bootstrapRestaurant(db, { nome: 'Casa X' })
    const userId = await createAuthUser(sql, 'dono@teste.local')
    await addStaff(db, { userId, restaurantId: rid, nome: 'Dono', papel: 'dono' })
    await addStaff(db, { userId, restaurantId: rid, nome: 'Dono', papel: 'dono' })
    expect(await db.select().from(staff)).toHaveLength(1)
  })

  it('bootstraps concorrentes criam um único restaurante', async () => {
    const ids = await Promise.all([
      bootstrapRestaurant(db, { nome: 'Casa X' }),
      bootstrapRestaurant(db, { nome: 'Casa X' }),
    ])
    expect(ids[0]).toBe(ids[1])
    expect(await db.select().from(restaurants)).toHaveLength(1)
  })
})
