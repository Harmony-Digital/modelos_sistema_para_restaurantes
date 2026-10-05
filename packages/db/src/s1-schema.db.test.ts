import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql as dsql } from 'drizzle-orm'
import { getTestDb, resetDb, seedRestaurant } from './test-utils.ts'
import { conversations, customers, knowledgeFacts, messages, restaurants, unitHourExceptions, unitHours } from './schema/index.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

describe('schema S1', () => {
  it('política de feriado padrão é como_domingo', async () => {
    const { restaurantId } = await seedRestaurant(db)
    const [r] = await db.select({ p: restaurants.politicaFeriado }).from(restaurants).where(eq(restaurants.id, restaurantId))
    expect(r!.p).toBe('como_domingo')
  })

  it('turno com abertura igual ao fechamento é rejeitado', async () => {
    const { restaurantId, unitId } = await seedRestaurant(db)
    await expect(
      db.insert(unitHours).values({ restaurantId, unitId, weekday: 1, turno: 1, abre: '11:00', fecha: '11:00' }),
    ).rejects.toMatchObject({ cause: { code: '23514', constraint_name: 'unit_hours_abre_fecha_diff' } })
  })

  it('horário não pode apontar para unidade de outro restaurante', async () => {
    const a = await seedRestaurant(db)
    const b = await seedRestaurant(db)
    await expect(
      db.insert(unitHours).values({ restaurantId: a.restaurantId, unitId: b.unitId, weekday: 1, turno: 1, abre: '11:00', fecha: '15:00' }),
    ).rejects.toMatchObject({ cause: { code: '23503', constraint_name: 'unit_hours_unit_fk' } })
  })

  it('exceção: fechado ⇔ sem turnos', async () => {
    const { restaurantId, unitId } = await seedRestaurant(db)
    await expect(
      db.insert(unitHourExceptions).values({ restaurantId, unitId, data: '2026-12-25', fechado: true, turnos: [{ abre: '11:00', fecha: '15:00' }] }),
    ).rejects.toMatchObject({ cause: { code: '23514', constraint_name: 'unit_hour_exceptions_fechado_turnos' } })
    await expect(
      db.insert(unitHourExceptions).values({ restaurantId, unitId, data: '2026-12-25', fechado: false, turnos: [] }),
    ).rejects.toMatchObject({ cause: { code: '23514', constraint_name: 'unit_hour_exceptions_fechado_turnos' } })
    await db.insert(unitHourExceptions).values({ restaurantId, unitId, data: '2026-12-25', fechado: true })
  })

  it('fato tem busca textual gerada (português, sem acento)', async () => {
    const { restaurantId } = await seedRestaurant(db)
    await db.insert(knowledgeFacts).values({ restaurantId, tema: 'Estacionamento', exemplos: ['tem vaga?'], texto: 'Temos estacionamento gratuito.' })
    const rows = await db.select({ id: knowledgeFacts.id }).from(knowledgeFacts)
      .where(dsql`${knowledgeFacts.search} @@ plainto_tsquery('portuguese', app.f_unaccent('estacionamentos'))`)
    expect(rows).toHaveLength(1)
  })

  it('mensagem de saída aceita localização com payload', async () => {
    const { restaurantId } = await seedRestaurant(db)
    const [c] = await db.insert(customers).values({ restaurantId, waIdHash: 'h', telefoneCifrado: 'x' }).returning()
    const [conv] = await db.insert(conversations).values({ restaurantId, customerId: c!.id }).returning()
    await db.insert(messages).values({
      restaurantId, conversationId: conv!.id, direcao: 'out', autor: 'ia', tipo: 'localizacao',
      texto: 'Asa Sul', payload: { lat: -15.8, lng: -47.9, nome: 'Asa Sul', endereco: 'SCLS 404' },
    })
    expect(conv!.simulada).toBe(false)
    expect(conv!.pendente).toBeNull()
  })
})
