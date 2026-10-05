import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getTestDb, resetDb, seedRestaurant, seedStaff } from './test-utils.ts'
import { getPanelStatus } from './panel.ts'
import { getStaffContext } from './staff.ts'
import { budgetCounters, workerHeartbeats } from './schema/ops.ts'
import { periodStarts } from '@atd/core'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

describe('painel', () => {
  it('getStaffContext reconhece o dono mesmo em aal1 (para mandar ao MFA)', async () => {
    const { restaurantId } = await seedRestaurant(db)
    const dono = await seedStaff(db, sql, { restaurantId, papel: 'dono' })
    expect(await getStaffContext(db, { sub: dono, role: 'authenticated', aal: 'aal1' })).toEqual({ role: 'dono', restaurantId })
  })

  it('getStaffContext devolve null para quem não é da equipe', async () => {
    await seedRestaurant(db)
    expect(await getStaffContext(db, { sub: '00000000-0000-0000-0000-000000000009', role: 'authenticated', aal: 'aal2' })).toBeNull()
  })

  it('status: atendente não vê custo; dono com MFA vê', async () => {
    const { restaurantId } = await seedRestaurant(db)
    await db.insert(workerHeartbeats).values({ workerId: 'w1', versao: '1' })
    await db.insert(budgetCounters).values({
      restaurantId, escopo: 'ia', periodo: 'dia',
      inicioPeriodo: periodStarts(new Date(), 'America/Sao_Paulo').dia, gasto: '0.123400',
    })
    const atendente = await seedStaff(db, sql, { restaurantId, papel: 'atendente' })
    const dono = await seedStaff(db, sql, { restaurantId, papel: 'dono' })
    const sA = await getPanelStatus(db, { sub: atendente, role: 'authenticated', aal: 'aal1' })
    const sD = await getPanelStatus(db, { sub: dono, role: 'authenticated', aal: 'aal2' })
    expect(sA.workerLastSeen).toBeInstanceOf(Date)
    expect(sA.gastoIaHojeUsd).toBeNull()
    expect(sD.gastoIaHojeUsd).toBe('0.123400')
  })
})
