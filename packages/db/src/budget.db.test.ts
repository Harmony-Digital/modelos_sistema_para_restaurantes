import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { getTestDb, resetDb, seedRestaurant } from './test-utils.ts'
import { budgetCounters, budgetLimits, spendLedger } from './schema/ops.ts'
import { releaseBudget, reserveBudget, settleBudget } from './budget.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const TZ = 'America/Sao_Paulo'
const now = new Date('2026-10-05T15:00:00Z')

async function setup(dia: string, mes: string) {
  const { restaurantId } = await seedRestaurant(db)
  await db.insert(budgetLimits).values([
    { restaurantId, escopo: 'ia', periodo: 'dia', limiteUsd: dia },
    { restaurantId, escopo: 'ia', periodo: 'mes', limiteUsd: mes },
  ])
  return restaurantId
}

const counters = (restaurantId: string) =>
  db.select().from(budgetCounters).where(eq(budgetCounters.restaurantId, restaurantId)).orderBy(budgetCounters.periodo)

describe('orçamento', () => {
  it('sem limite configurado nega (fail closed)', async () => {
    const { restaurantId } = await seedRestaurant(db)
    expect(await reserveBudget(db, { restaurantId, scope: 'ia', amountUsd: '0.01', timeZone: TZ, now })).toBeNull()
  })

  it('reserva dentro do limite e registra no ledger', async () => {
    const restaurantId = await setup('1', '10')
    const r = await reserveBudget(db, { restaurantId, scope: 'ia', amountUsd: '0.05', timeZone: TZ, now, ref: 'teste' })
    expect(r?.counterIds).toHaveLength(2)
    expect((await counters(restaurantId)).map((c) => c.reservado)).toEqual(['0.050000', '0.050000'])
    const ledger = await db.select().from(spendLedger)
    expect(ledger.map((l) => [l.tipo, l.valorUsd])).toEqual([['reserva', '0.050000']])
  })

  it('tudo ou nada: mês estourado não deixa reserva pendurada no dia', async () => {
    const restaurantId = await setup('1', '0.03')
    expect(await reserveBudget(db, { restaurantId, scope: 'ia', amountUsd: '0.05', timeZone: TZ, now })).toBeNull()
    expect((await counters(restaurantId)).every((c) => c.reservado === '0.000000')).toBe(true)
  })

  it('100 reservas concorrentes nunca ultrapassam o teto', async () => {
    const restaurantId = await setup('1', '100')
    const results = await Promise.all(
      Array.from({ length: 100 }, () =>
        reserveBudget(db, { restaurantId, scope: 'ia', amountUsd: '0.02', timeZone: TZ, now }),
      ),
    )
    expect(results.filter(Boolean)).toHaveLength(50)
    const [dia] = await counters(restaurantId)
    expect(dia!.reservado).toBe('1.000000')
  })

  it('liquidação troca reserva pelo custo real', async () => {
    const restaurantId = await setup('1', '10')
    const r = await reserveBudget(db, { restaurantId, scope: 'ia', amountUsd: '0.05', timeZone: TZ, now })
    await settleBudget(db, r!, '0.0123', 'run-1')
    const [dia] = await counters(restaurantId)
    expect([dia!.reservado, dia!.gasto]).toEqual(['0.000000', '0.012300'])
  })

  it('estorno devolve a reserva sem gasto', async () => {
    const restaurantId = await setup('1', '10')
    const r = await reserveBudget(db, { restaurantId, scope: 'ia', amountUsd: '0.05', timeZone: TZ, now })
    await releaseBudget(db, r!)
    const [dia] = await counters(restaurantId)
    expect([dia!.reservado, dia!.gasto]).toEqual(['0.000000', '0.000000'])
  })

  it('gasto do dia anterior não conta no dia seguinte', async () => {
    const restaurantId = await setup('0.05', '10')
    const r = await reserveBudget(db, { restaurantId, scope: 'ia', amountUsd: '0.05', timeZone: TZ, now })
    await settleBudget(db, r!, '0.05')
    const amanha = new Date('2026-10-06T15:00:00Z')
    expect(await reserveBudget(db, { restaurantId, scope: 'ia', amountUsd: '0.05', timeZone: TZ, now })).toBeNull()
    expect(await reserveBudget(db, { restaurantId, scope: 'ia', amountUsd: '0.05', timeZone: TZ, now: amanha })).not.toBeNull()
  })
})
