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
    const limites = await db.select().from(budgetLimits)
    expect(limites).toHaveLength(6)
    // simulação tem limite próprio (Etapa 08): US$ 1/dia e 10/mês
    expect(limites.filter((l) => l.escopo === 'simulacao').map((l) => [l.periodo, l.limiteUsd]).sort())
      .toEqual([['dia', '1.000000'], ['mes', '10.000000']])
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
