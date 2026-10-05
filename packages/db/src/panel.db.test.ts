import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getTestDb, resetDb, seedRestaurant, seedStaff } from './test-utils.ts'
import { getPanelStatus } from './panel.ts'
import { getStaffContext } from './staff.ts'
import { budgetCounters, workerHeartbeats } from './schema/ops.ts'
import { periodStarts } from '@atd/core'
import { conversations, customers } from './schema/index.ts'

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

  it('status: atendente não vê custo; dono com MFA vê IA e WhatsApp, do dia e do mês', async () => {
    const { restaurantId } = await seedRestaurant(db)
    await db.insert(workerHeartbeats).values({ workerId: 'w1', versao: '1' })
    const { dia, mes } = periodStarts(new Date(), 'America/Sao_Paulo')
    await db.insert(budgetCounters).values([
      { restaurantId, escopo: 'ia', periodo: 'dia', inicioPeriodo: dia, gasto: '0.123400' },
      { restaurantId, escopo: 'ia', periodo: 'mes', inicioPeriodo: mes, gasto: '2.500000' },
      { restaurantId, escopo: 'whatsapp', periodo: 'dia', inicioPeriodo: dia, gasto: '0.062500' },
      { restaurantId, escopo: 'whatsapp', periodo: 'mes', inicioPeriodo: mes, gasto: '1.250000' },
      // dia anterior não entra
      { restaurantId, escopo: 'ia', periodo: 'dia', inicioPeriodo: '2000-01-01', gasto: '9.000000' },
    ])
    const atendente = await seedStaff(db, sql, { restaurantId, papel: 'atendente' })
    const dono = await seedStaff(db, sql, { restaurantId, papel: 'dono' })
    const sA = await getPanelStatus(db, { sub: atendente, role: 'authenticated', aal: 'aal1' })
    const sD = await getPanelStatus(db, { sub: dono, role: 'authenticated', aal: 'aal2' })
    expect(sA.workerLastSeen).toBeInstanceOf(Date)
    expect(sA.gastos).toEqual({ ia: { dia: null, mes: null }, whatsapp: { dia: null, mes: null } })
    expect(sD.gastos).toEqual({ ia: { dia: '0.123400', mes: '2.500000' }, whatsapp: { dia: '0.062500', mes: '1.250000' } })
  })

  it('status: sem gasto registrado, o dono vê null (exibido como zero)', async () => {
    const { restaurantId } = await seedRestaurant(db)
    const dono = await seedStaff(db, sql, { restaurantId, papel: 'dono' })
    const s = await getPanelStatus(db, { sub: dono, role: 'authenticated', aal: 'aal2' })
    expect(s.gastos).toEqual({ ia: { dia: null, mes: null }, whatsapp: { dia: null, mes: null } })
  })

  it('status: "aguardando atendente" conta aguardando_humano e humano, não ia/encerrada', async () => {
    const { restaurantId } = await seedRestaurant(db)
    const atendente = await seedStaff(db, sql, { restaurantId, papel: 'atendente' })
    for (const estado of ['aguardando_humano', 'humano', 'ia', 'encerrada'] as const) {
      const [c] = await db.insert(customers).values({ restaurantId, waIdHash: crypto.randomUUID(), telefoneCifrado: 'x' }).returning()
      await db.insert(conversations).values({ restaurantId, customerId: c!.id, estado })
    }
    const s = await getPanelStatus(db, { sub: atendente, role: 'authenticated', aal: 'aal1' })
    expect(s.aguardandoHumano).toBe(2)
    expect(s.conversasAbertas).toBe(3)
  })
})
