import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { getTestDb, resetDb, seedRestaurant, seedStaff } from './test-utils.ts'
import { withRole, withUserContext, type JwtClaims } from './rls.ts'
import { knowledgeFacts, knowledgeGaps, staff, unitHourExceptions, unitHours, units } from './schema/index.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const as = (sub: string, aal: 'aal1' | 'aal2' = 'aal2'): JwtClaims => ({ sub, role: 'authenticated', aal })
const denied = { cause: { code: '42501' } }

async function cenario() {
  const { restaurantId, unitId: u1 } = await seedRestaurant(db)
  const [u2] = await db.insert(units).values({ restaurantId, nome: 'Asa Norte', slug: 'asa-norte' }).returning()
  for (const unitId of [u1, u2!.id]) {
    await db.insert(unitHours).values({ restaurantId, unitId, weekday: 1, turno: 1, abre: '11:00', fecha: '15:00' })
  }
  const dono = await seedStaff(db, sql, { restaurantId, papel: 'dono' })
  const gerenteTodas = await seedStaff(db, sql, { restaurantId, papel: 'gerente' })
  const gerenteU1 = await seedStaff(db, sql, { restaurantId, papel: 'gerente' })
  await db.update(staff).set({ unidadesPermitidas: [u1] }).where(eq(staff.userId, gerenteU1))
  const atendente = await seedStaff(db, sql, { restaurantId, papel: 'atendente' })
  return { restaurantId, u1, u2: u2!.id, dono, gerenteTodas, gerenteU1, atendente }
}

describe('RLS por unidade (S1)', () => {
  it('dono e gerente sem restrição veem todas; gerente restrito só a sua unidade e os horários dela', async () => {
    const c = await cenario()
    for (const quem of [c.dono, c.gerenteTodas]) {
      const us = await withUserContext(db, as(quem), (tx) => tx.select().from(units))
      expect(us).toHaveLength(2)
    }
    const us = await withUserContext(db, as(c.gerenteU1), (tx) => tx.select().from(units))
    expect(us.map((u) => u.id)).toEqual([c.u1])
    const hs = await withUserContext(db, as(c.gerenteU1), (tx) => tx.select().from(unitHours))
    expect(hs.map((h) => h.unitId)).toEqual([c.u1])
  })

  it('gerente restrito não grava horário de outra unidade; atendente só lê', async () => {
    const c = await cenario()
    await expect(
      withUserContext(db, as(c.gerenteU1), (tx) =>
        tx.insert(unitHours).values({ restaurantId: c.restaurantId, unitId: c.u2, weekday: 2, turno: 1, abre: '11:00', fecha: '15:00' })),
    ).rejects.toMatchObject(denied)
    await withUserContext(db, as(c.gerenteU1), (tx) =>
      tx.insert(unitHours).values({ restaurantId: c.restaurantId, unitId: c.u1, weekday: 2, turno: 1, abre: '11:00', fecha: '15:00' }))
    const lidos = await withUserContext(db, as(c.atendente, 'aal1'), (tx) => tx.select().from(unitHours))
    expect(lidos.length).toBeGreaterThan(0)
    await expect(
      withUserContext(db, as(c.atendente, 'aal1'), (tx) =>
        tx.insert(unitHours).values({ restaurantId: c.restaurantId, unitId: c.u1, weekday: 3, turno: 1, abre: '11:00', fecha: '15:00' })),
    ).rejects.toMatchObject(denied)
  })

  it('fato geral: todos leem; só quem acessa todas as unidades altera', async () => {
    const c = await cenario()
    await db.insert(knowledgeFacts).values({ restaurantId: c.restaurantId, tema: 'Estacionamento', texto: 'Temos estacionamento.' })
    const lido = await withUserContext(db, as(c.gerenteU1), (tx) => tx.select().from(knowledgeFacts))
    expect(lido).toHaveLength(1)
    const alterados = await withUserContext(db, as(c.gerenteU1), (tx) =>
      tx.update(knowledgeFacts).set({ texto: 'Mudou' }).returning({ id: knowledgeFacts.id }))
    expect(alterados).toHaveLength(0) // RLS: linha invisível para UPDATE
    const ok = await withUserContext(db, as(c.gerenteTodas), (tx) =>
      tx.update(knowledgeFacts).set({ texto: 'Mudou' }).returning({ id: knowledgeFacts.id }))
    expect(ok).toHaveLength(1)
  })

  it('painel não reaponta unidade para outro restaurante nem cria lacuna', async () => {
    const c = await cenario()
    const outro = await seedRestaurant(db)
    await expect(
      withUserContext(db, as(c.dono), (tx) => tx.update(units).set({ restaurantId: outro.restaurantId }).where(eq(units.id, c.u1))),
    ).rejects.toMatchObject(denied)
    await expect(
      withUserContext(db, as(c.dono), (tx) =>
        tx.insert(knowledgeGaps).values({ restaurantId: c.restaurantId, chaveNormalizada: 'info:wifi' })),
    ).rejects.toMatchObject(denied)
  })

  it('worker_app lê horários e registra lacunas, mas não apaga', async () => {
    const c = await cenario()
    const hs = await withRole(db, 'worker_app', (tx) => tx.select().from(unitHours).where(eq(unitHours.restaurantId, c.restaurantId)))
    expect(hs).toHaveLength(2)
    await withRole(db, 'worker_app', (tx) =>
      tx.insert(knowledgeGaps).values({ restaurantId: c.restaurantId, chaveNormalizada: 'info:wifi', perguntaMascarada: 'tem wifi?' }))
    await withRole(db, 'worker_app', (tx) => tx.update(knowledgeGaps).set({ ocorrencias: 2 }))
    await expect(withRole(db, 'worker_app', (tx) => tx.delete(knowledgeGaps))).rejects.toMatchObject(denied)
  })

  it('só uma lacuna aberta por chave e unidade, inclusive sem unidade', async () => {
    const c = await cenario()
    await db.insert(knowledgeGaps).values({ restaurantId: c.restaurantId, chaveNormalizada: 'info:wifi' })
    await expect(
      db.insert(knowledgeGaps).values({ restaurantId: c.restaurantId, chaveNormalizada: 'info:wifi' }),
    ).rejects.toMatchObject({ cause: { code: '23505', constraint_name: 'knowledge_gaps_aberta_uq' } })
    await db.update(knowledgeGaps).set({ status: 'respondida' })
    await db.insert(knowledgeGaps).values({ restaurantId: c.restaurantId, chaveNormalizada: 'info:wifi' })
  })

  it('painel não aponta lacuna para fato de outro restaurante; apagar o fato zera só fact_id', async () => {
    const c = await cenario()
    const outro = await seedRestaurant(db)
    const [fatoOutro] = await db.insert(knowledgeFacts)
      .values({ restaurantId: outro.restaurantId, tema: 'Wifi', texto: 'Temos wifi.' }).returning()
    const [fato] = await db.insert(knowledgeFacts)
      .values({ restaurantId: c.restaurantId, tema: 'Wifi', texto: 'Temos wifi.' }).returning()
    const [gap] = await db.insert(knowledgeGaps)
      .values({ restaurantId: c.restaurantId, chaveNormalizada: 'info:wifi' }).returning()
    await expect(
      withUserContext(db, as(c.dono), (tx) =>
        tx.update(knowledgeGaps).set({ factId: fatoOutro!.id }).where(eq(knowledgeGaps.id, gap!.id))),
    ).rejects.toMatchObject({ cause: { code: '23503', constraint_name: 'knowledge_gaps_fact_fk' } })
    await withUserContext(db, as(c.dono), (tx) =>
      tx.update(knowledgeGaps).set({ factId: fato!.id }).where(eq(knowledgeGaps.id, gap!.id)))
    await db.delete(knowledgeFacts).where(eq(knowledgeFacts.id, fato!.id))
    const [depois] = await db.select().from(knowledgeGaps).where(eq(knowledgeGaps.id, gap!.id))
    expect(depois!.factId).toBeNull()
    expect(depois!.restaurantId).toBe(c.restaurantId)
  })

  it('gerente restrito não vê fato, exceção nem lacuna de outra unidade', async () => {
    const c = await cenario()
    await db.insert(knowledgeFacts).values([
      { restaurantId: c.restaurantId, unitId: c.u1, tema: 'Varanda', texto: 'Tem varanda.' },
      { restaurantId: c.restaurantId, unitId: c.u2, tema: 'Piscina', texto: 'Tem piscina.' },
    ])
    const fatos = await withUserContext(db, as(c.gerenteU1), (tx) => tx.select().from(knowledgeFacts))
    expect(fatos.map((f) => f.tema)).toEqual(['Varanda'])

    for (const unitId of [c.u1, c.u2]) {
      await db.insert(unitHourExceptions).values({ restaurantId: c.restaurantId, unitId, data: '2026-12-25', fechado: true })
    }
    const exc = await withUserContext(db, as(c.gerenteU1), (tx) => tx.select().from(unitHourExceptions))
    expect(exc.map((e) => e.unitId)).toEqual([c.u1])

    await db.insert(knowledgeGaps).values([
      { restaurantId: c.restaurantId, unitId: c.u1, chaveNormalizada: 'info:a' },
      { restaurantId: c.restaurantId, unitId: c.u2, chaveNormalizada: 'info:b' },
    ])
    const gaps = await withUserContext(db, as(c.gerenteU1), (tx) => tx.select().from(knowledgeGaps))
    expect(gaps.map((g) => g.chaveNormalizada)).toEqual(['info:a'])
  })

  it('worker_app não altera status da lacuna; authenticated não tem MAINTAIN', async () => {
    const c = await cenario()
    await db.insert(knowledgeGaps).values({ restaurantId: c.restaurantId, chaveNormalizada: 'info:wifi' })
    await expect(
      withRole(db, 'worker_app', (tx) => tx.update(knowledgeGaps).set({ status: 'respondida' })),
    ).rejects.toMatchObject(denied)
    const r = await sql`select has_table_privilege('authenticated','public.units','MAINTAIN') as m`
    expect(r[0]!.m).toBe(false)
  })
})
