import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { getTestDb, resetDb, seedRestaurant, seedStaff } from './test-utils.ts'
import { withRole, withUserContext, type JwtClaims } from './rls.ts'
import { attendanceNotices, staff, units } from './schema/index.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const as = (sub: string): JwtClaims => ({ sub, role: 'authenticated', aal: 'aal2' })

describe('RLS de attendance_notices', () => {
  it('RLS ligada; policies usam funções de initplan, nunca can_access_unit', async () => {
    const [t] = await sql<{ rowsecurity: boolean }[]>`select rowsecurity from pg_tables where tablename = 'attendance_notices'`
    expect(t?.rowsecurity).toBe(true)
    const rows = await sql<{ name: string; expr: string }[]>`
      select policyname as name, coalesce(qual, '') || ' ' || coalesce(with_check, '') as expr
        from pg_policies where schemaname = 'public' and tablename = 'attendance_notices'
         and policyname in ('equipe_read', 'gestao_insert', 'gestao_update')`
    expect(rows).toHaveLength(3)
    for (const r of rows) {
      expect(r.expr, r.name).not.toContain('can_access_unit')
      expect(r.expr, r.name).toContain('acesso_todas_unidades')
      expect(r.expr, r.name).toContain('minhas_unidades')
    }
  })

  it('sem grant de delete; authenticated só lê/insere/atualiza', async () => {
    const { restaurantId, unitId } = await seedRestaurant(db)
    const dono = await seedStaff(db, sql, { restaurantId, papel: 'dono' })
    await db.insert(attendanceNotices).values({ restaurantId, unitId, data: '2026-10-10', pessoas: 2, origem: 'ia' })
    await expect(withUserContext(db, as(dono), (tx) => tx.delete(attendanceNotices))).rejects.toMatchObject({ cause: { code: '42501' } })
    await expect(withRole(db, 'worker_app', (tx) => tx.delete(attendanceNotices))).rejects.toMatchObject({ cause: { code: '42501' } })
  })

  it('isola por restaurante e por unidade', async () => {
    const a = await seedRestaurant(db)
    const b = await seedRestaurant(db)
    const [u2] = await db.insert(units).values({ restaurantId: a.restaurantId, nome: 'Norte', slug: 'norte' }).returning()
    await db.insert(attendanceNotices).values([
      { restaurantId: a.restaurantId, unitId: a.unitId, data: '2026-10-10', pessoas: 2, origem: 'ia' },
      { restaurantId: a.restaurantId, unitId: u2!.id, data: '2026-10-10', pessoas: 3, origem: 'ia' },
      { restaurantId: b.restaurantId, unitId: b.unitId, data: '2026-10-10', pessoas: 4, origem: 'ia' },
    ])
    const donoA = await seedStaff(db, sql, { restaurantId: a.restaurantId, papel: 'dono' })
    const gerente = await seedStaff(db, sql, { restaurantId: a.restaurantId, papel: 'gerente' })
    await db.update(staff).set({ unidadesPermitidas: [a.unitId] }).where(eq(staff.userId, gerente))
    expect(await withUserContext(db, as(donoA), (tx) => tx.select().from(attendanceNotices))).toHaveLength(2)
    expect((await withUserContext(db, as(gerente), (tx) => tx.select().from(attendanceNotices))).map((x) => x.unitId)).toEqual([a.unitId])
    await expect(withUserContext(db, as(gerente), (tx) =>
      tx.insert(attendanceNotices).values({ restaurantId: a.restaurantId, unitId: u2!.id, data: '2026-10-10', pessoas: 1, origem: 'painel' }),
    )).rejects.toMatchObject({ cause: { code: '42501' } })
  })
})
