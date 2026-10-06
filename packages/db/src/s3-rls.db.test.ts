import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql as dsql } from 'drizzle-orm'
import { getTestDb, resetDb, seedRestaurant, seedStaff } from './test-utils.ts'
import { withRole, withUserContext, type JwtClaims } from './rls.ts'
import { eventRequests, eventSpaces, staff, units } from './schema/index.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const as = (sub: string, aal: 'aal1' | 'aal2' = 'aal2'): JwtClaims => ({ sub, role: 'authenticated', aal })
const negado = { cause: { code: '42501' } }

describe('RLS de event_spaces e event_requests', () => {
  it('RLS ligada; policies usam funções de initplan, nunca can_access_unit', async () => {
    const ts = await sql<{ tablename: string; rowsecurity: boolean }[]>`
      select tablename, rowsecurity from pg_tables where tablename in ('event_spaces', 'event_requests') order by 1`
    expect(ts).toEqual([{ tablename: 'event_requests', rowsecurity: true }, { tablename: 'event_spaces', rowsecurity: true }])
    const rows = await sql<{ t: string; name: string; expr: string }[]>`
      select tablename as t, policyname as name, coalesce(qual, '') || ' ' || coalesce(with_check, '') as expr
        from pg_policies where schemaname = 'public' and tablename in ('event_spaces', 'event_requests')
         and policyname in ('equipe_read', 'gestao_write', 'equipe_update')`
    expect(rows).toHaveLength(4)
    for (const r of rows) {
      expect(r.expr, `${r.t}.${r.name}`).not.toContain('can_access_unit')
      expect(r.expr, `${r.t}.${r.name}`).toContain('acesso_todas_unidades')
      expect(r.expr, `${r.t}.${r.name}`).toContain('minhas_unidades')
    }
  })

  it('sem delete para ninguém da aplicação', async () => {
    const { restaurantId, unitId } = await seedRestaurant(db)
    const dono = await seedStaff(db, sql, { restaurantId, papel: 'dono' })
    await db.insert(eventSpaces).values({ restaurantId, unitId, nome: 'Salão', capacidadeMin: 1, capacidadeMax: 50 })
    await db.insert(eventRequests).values({ restaurantId, unitId, data: '2026-11-20', convidados: 30, tipo: 'aniversario' })
    for (const t of [eventSpaces, eventRequests]) {
      await expect(withUserContext(db, as(dono), (tx) => tx.delete(t))).rejects.toMatchObject(negado)
      await expect(withRole(db, 'worker_app', (tx) => tx.delete(t))).rejects.toMatchObject(negado)
      await expect(withRole(db, 'web_app', (tx) => tx.delete(t))).rejects.toMatchObject(negado)
    }
  })

  it('isola por restaurante e unidade; simulado nunca aparece; dono sem MFA não vê', async () => {
    const a = await seedRestaurant(db)
    const b = await seedRestaurant(db)
    const [u2] = await db.insert(units).values({ restaurantId: a.restaurantId, nome: 'Norte', slug: 'norte' }).returning()
    const base = { data: '2026-11-20', convidados: 30, tipo: 'aniversario' as const }
    await db.insert(eventRequests).values([
      { ...base, restaurantId: a.restaurantId, unitId: a.unitId },
      { ...base, restaurantId: a.restaurantId, unitId: u2!.id },
      { ...base, restaurantId: a.restaurantId, unitId: a.unitId, simulado: true },
      { ...base, restaurantId: b.restaurantId, unitId: b.unitId },
    ])
    await db.insert(eventSpaces).values([
      { restaurantId: a.restaurantId, unitId: a.unitId, nome: 'Salão', capacidadeMin: 1, capacidadeMax: 50 },
      { restaurantId: a.restaurantId, unitId: u2!.id, nome: 'Salão', capacidadeMin: 1, capacidadeMax: 50 },
      { restaurantId: b.restaurantId, unitId: b.unitId, nome: 'Salão', capacidadeMin: 1, capacidadeMax: 50 },
    ])
    const dono = await seedStaff(db, sql, { restaurantId: a.restaurantId, papel: 'dono' })
    const gerente = await seedStaff(db, sql, { restaurantId: a.restaurantId, papel: 'gerente' })
    await db.update(staff).set({ unidadesPermitidas: [a.unitId] }).where(eq(staff.userId, gerente))
    const atendente = await seedStaff(db, sql, { restaurantId: a.restaurantId, papel: 'atendente' })
    expect(await withUserContext(db, as(dono), (tx) => tx.select().from(eventRequests))).toHaveLength(2)
    expect(await withUserContext(db, as(dono), (tx) => tx.select().from(eventSpaces))).toHaveLength(2)
    expect(await withUserContext(db, as(dono, 'aal1'), (tx) => tx.select().from(eventRequests))).toHaveLength(0)
    expect((await withUserContext(db, as(gerente), (tx) => tx.select().from(eventRequests))).map((x) => x.unitId)).toEqual([a.unitId])
    expect((await withUserContext(db, as(gerente), (tx) => tx.select().from(eventSpaces))).map((x) => x.unitId)).toEqual([a.unitId])
    expect(await withUserContext(db, as(atendente, 'aal1'), (tx) => tx.select().from(eventRequests))).toHaveLength(2)
  })

  it('event_requests: authenticated não insere; só atualiza status/responsável/notas; não muda simulado nem unidade', async () => {
    const { restaurantId, unitId } = await seedRestaurant(db)
    const [u2] = await db.insert(units).values({ restaurantId, nome: 'Norte', slug: 'norte' }).returning()
    const dono = await seedStaff(db, sql, { restaurantId, papel: 'dono' })
    const atendente = await seedStaff(db, sql, { restaurantId, papel: 'atendente' })
    const [p, sim] = await db.insert(eventRequests).values([
      { restaurantId, unitId, data: '2026-11-20', convidados: 30, tipo: 'aniversario' },
      { restaurantId, unitId, data: '2026-11-20', convidados: 30, tipo: 'aniversario', simulado: true },
    ]).returning()
    await expect(withUserContext(db, as(dono), (tx) =>
      tx.execute(dsql`insert into public.event_requests (restaurant_id, unit_id, data, convidados, tipo) values (${restaurantId}, ${unitId}, '2026-11-20', 10, 'outro')`),
    )).rejects.toMatchObject(negado)
    await expect(withUserContext(db, as(dono), (tx) =>
      tx.update(eventRequests).set({ simulado: true }).where(eq(eventRequests.id, p!.id)),
    )).rejects.toMatchObject(negado)
    await expect(withUserContext(db, as(dono), (tx) =>
      tx.update(eventRequests).set({ unitId: u2!.id }).where(eq(eventRequests.id, p!.id)),
    )).rejects.toMatchObject(negado)
    await expect(withUserContext(db, as(dono), (tx) =>
      tx.update(eventRequests).set({ convidados: 99 }).where(eq(eventRequests.id, p!.id)),
    )).rejects.toMatchObject(negado)
    const r = await withUserContext(db, as(atendente, 'aal1'), (tx) =>
      tx.update(eventRequests).set({ status: 'em_contato', responsavelId: atendente, notasInternas: 'ligar' }).where(eq(eventRequests.id, p!.id)).returning({ id: eventRequests.id }),
    )
    expect(r).toHaveLength(1)
    // simulado é invisível também para update
    const s = await withUserContext(db, as(dono), (tx) =>
      tx.update(eventRequests).set({ status: 'em_contato' }).where(eq(eventRequests.id, sim!.id)).returning({ id: eventRequests.id }),
    )
    expect(s).toHaveLength(0)
  })

  it('event_spaces: dono/gerente gravam só as colunas do formulário na unidade permitida; atendente não', async () => {
    const { restaurantId, unitId } = await seedRestaurant(db)
    const [u2] = await db.insert(units).values({ restaurantId, nome: 'Norte', slug: 'norte' }).returning()
    const gerente = await seedStaff(db, sql, { restaurantId, papel: 'gerente' })
    await db.update(staff).set({ unidadesPermitidas: [unitId] }).where(eq(staff.userId, gerente))
    const atendente = await seedStaff(db, sql, { restaurantId, papel: 'atendente' })
    const ins = (quem: string, unit: string, aal: 'aal1' | 'aal2' = 'aal2') => withUserContext(db, as(quem, aal), (tx) => tx.execute(dsql`
      insert into public.event_spaces (restaurant_id, unit_id, nome, capacidade_min, capacidade_max)
      values (${restaurantId}, ${unit}, 'Salão', 1, 20) returning id`))
    await expect(ins(gerente, u2!.id)).rejects.toMatchObject(negado)
    await expect(ins(atendente, unitId, 'aal1')).rejects.toMatchObject(negado)
    const [e] = await ins(gerente, unitId)
    // id e restaurant não mudam
    await expect(withUserContext(db, as(gerente), (tx) =>
      tx.update(eventSpaces).set({ unitId: u2!.id }).where(eq(eventSpaces.id, (e as { id: string }).id)),
    )).rejects.toMatchObject(negado)
    const r = await withUserContext(db, as(atendente, 'aal1'), (tx) =>
      tx.update(eventSpaces).set({ nome: 'X' }).where(eq(eventSpaces.id, (e as { id: string }).id)).returning({ id: eventSpaces.id }),
    )
    expect(r).toHaveLength(0)
  })
})
