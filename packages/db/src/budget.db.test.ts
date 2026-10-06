import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { getTestDb, resetDb, seedRestaurant } from './test-utils.ts'
import { withRole } from './rls.ts'
import { budgetCounters, budgetLimits, spendLedger } from './schema/ops.ts'
import { liberarReservasPendentes, releaseBudget, reserveBudget, settleBudget } from './budget.ts'

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
    const [dia, mes] = await counters(restaurantId)
    expect(dia!.reservado).toBe('1.000000')
    expect(mes!.reservado).toBe('1.000000')
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

  it('liquidar duas vezes é no-op', async () => {
    const restaurantId = await setup('1', '10')
    const r = await reserveBudget(db, { restaurantId, scope: 'ia', amountUsd: '0.05', timeZone: TZ, now })
    await settleBudget(db, r!, '0.01')
    await settleBudget(db, r!, '0.01')
    const [dia] = await counters(restaurantId)
    expect([dia!.reservado, dia!.gasto]).toEqual(['0.000000', '0.010000'])
    const ledger = await db.select().from(spendLedger)
    expect(ledger.filter((l) => l.tipo === 'liquidacao')).toHaveLength(1)
  })

  it('liquidar e depois estornar: estorno é no-op e não libera reserva alheia', async () => {
    const restaurantId = await setup('1', '10')
    const a = await reserveBudget(db, { restaurantId, scope: 'ia', amountUsd: '0.5', timeZone: TZ, now })
    await reserveBudget(db, { restaurantId, scope: 'ia', amountUsd: '0.5', timeZone: TZ, now })
    await settleBudget(db, a!, '0.1')
    await releaseBudget(db, a!)
    await releaseBudget(db, a!)
    const [dia] = await counters(restaurantId)
    expect([dia!.reservado, dia!.gasto]).toEqual(['0.500000', '0.100000'])
    expect(await reserveBudget(db, { restaurantId, scope: 'ia', amountUsd: '0.5', timeZone: TZ, now })).toBeNull()
  })

  it('valores inválidos lançam sem escrever', async () => {
    const restaurantId = await setup('1', '10')
    for (const amountUsd of ['-1', '0', 'abc', '0.0000001']) {
      await expect(reserveBudget(db, { restaurantId, scope: 'ia', amountUsd, timeZone: TZ, now })).rejects.toThrow(
        'Valor em USD inválido',
      )
    }
    const r = await reserveBudget(db, { restaurantId, scope: 'ia', amountUsd: '0.05', timeZone: TZ, now })
    await expect(settleBudget(db, r!, '-0.01')).rejects.toThrow('Valor em USD inválido')
    expect(await db.select().from(spendLedger)).toHaveLength(1)
  })

  it('linhas de liquidação carregam reserva_id', async () => {
    const restaurantId = await setup('1', '10')
    const r = await reserveBudget(db, { restaurantId, scope: 'ia', amountUsd: '0.05', timeZone: TZ, now })
    await settleBudget(db, r!, '0.01')
    const ledger = await db.select().from(spendLedger).orderBy(spendLedger.id)
    expect(ledger[1]!.tipo).toBe('liquidacao')
    expect(ledger[1]!.reservaId).toBe(r!.reservationId)
    expect(ledger[0]!.id).toBe(r!.reservationId)
  })

  it('liberarReservasPendentes: devolve só as reservas do ref ainda abertas (processo que morreu), uma vez só', async () => {
    const restaurantId = await setup('1', '10')
    const ref = 'importacao:x'
    // relógio real: o ledger grava now() do banco e a liberação acha os contadores pelo período desse instante
    await reserveBudget(db, { restaurantId, scope: 'ia', amountUsd: '0.50', timeZone: TZ, ref })
    const liquidada = await reserveBudget(db, { restaurantId, scope: 'ia', amountUsd: '0.20', timeZone: TZ, ref })
    await settleBudget(db, liquidada!, '0.01', ref)
    await reserveBudget(db, { restaurantId, scope: 'ia', amountUsd: '0.10', timeZone: TZ, ref: 'outro' })
    expect((await counters(restaurantId)).map((c) => c.reservado)).toEqual(['0.600000', '0.600000'])

    expect(await withRole(db, 'worker_app', (tx) => liberarReservasPendentes(tx, { restaurantId, ref, timeZone: TZ }))).toBe(1)
    expect((await counters(restaurantId)).map((c) => [c.reservado, c.gasto])).toEqual([['0.100000', '0.010000'], ['0.100000', '0.010000']])
    expect(await liberarReservasPendentes(db, { restaurantId, ref, timeZone: TZ })).toBe(0)
    expect((await counters(restaurantId)).map((c) => c.reservado)).toEqual(['0.100000', '0.100000'])
  })
})

