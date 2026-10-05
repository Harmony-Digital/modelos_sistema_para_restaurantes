import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getTestDb, resetDb, seedRestaurant } from './test-utils.ts'
import { units } from './schema/restaurant.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

describe('schema base', () => {
  it('extensões instaladas', async () => {
    const rows = await sql<{ extname: string }[]>`select extname from pg_extension where extname in ('pg_trgm','unaccent')`
    expect(rows.map((r) => r.extname).sort()).toEqual(['pg_trgm', 'unaccent'])
  })

  it('slug de unidade é único por restaurante', async () => {
    const { restaurantId } = await seedRestaurant(db)
    await expect(
      db.insert(units).values({ restaurantId, nome: 'Outra', slug: 'asa-sul' }),
    ).rejects.toMatchObject({ cause: { code: '23505', constraint_name: 'units_restaurant_slug_uq' } }) // drizzle 0.45 embrulha o erro do driver em `cause`
  })
})
