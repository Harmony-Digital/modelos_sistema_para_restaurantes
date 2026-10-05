import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getTestDb, resetDb, seedRestaurant } from './test-utils.ts'
import { aiRuns, budgetLimits } from './schema/ops.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

describe('ops', () => {
  it('custo guarda 6 casas sem erro de ponto flutuante', async () => {
    const { restaurantId } = await seedRestaurant(db)
    const [run] = await db
      .insert(aiRuns)
      .values({ restaurantId, etapa: 'triagem', modelo: 'x/y', promptVersion: 'triage-v1', costUsd: '0.000178' })
      .returning()
    expect(run!.costUsd).toBe('0.000178')
  })

  it('um limite por escopo e período', async () => {
    const { restaurantId } = await seedRestaurant(db)
    const lim = { restaurantId, escopo: 'ia', periodo: 'dia', limiteUsd: '5' } as const
    await db.insert(budgetLimits).values(lim)
    await expect(db.insert(budgetLimits).values(lim)).rejects.toMatchObject({
      cause: { code: '23505', constraint_name: 'budget_limits_scope_period_uq' },
    })
  })

  it('limite precisa ser positivo', async () => {
    const { restaurantId } = await seedRestaurant(db)
    await expect(
      db.insert(budgetLimits).values({ restaurantId, escopo: 'ia', periodo: 'mes', limiteUsd: '-1' }),
    ).rejects.toMatchObject({
      cause: { code: '23514', constraint_name: 'budget_limits_limite_positive' },
    })
  })
})
