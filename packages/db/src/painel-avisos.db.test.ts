import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { getTestDb, resetDb, seedRestaurant, seedStaff } from './test-utils.ts'
import type { JwtClaims } from './rls.ts'
import { cancelarAvisoPainel, criarAvisoPainel, previsaoDoDia, totalPrevistoHoje } from './painel-avisos.ts'
import { attendanceNotices, auditLog, staff, units } from './schema/index.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const as = (sub: string): JwtClaims => ({ sub, role: 'authenticated', aal: 'aal2' })
const DIA = '2026-10-10'

async function cenario() {
  const { restaurantId, unitId: u1 } = await seedRestaurant(db)
  await db.update(units).set({ ordem: 2 }).where(eq(units.id, u1))
  const [u2] = await db.insert(units).values({ restaurantId, nome: 'Asa Norte', slug: 'asa-norte', ordem: 1 }).returning()
  const dono = await seedStaff(db, sql, { restaurantId, papel: 'dono' })
  const gerenteU1 = await seedStaff(db, sql, { restaurantId, papel: 'gerente' })
  await db.update(staff).set({ unidadesPermitidas: [u1] }).where(eq(staff.userId, gerenteU1))
  const atendente = await seedStaff(db, sql, { restaurantId, papel: 'atendente' })
  return { restaurantId, u1, u2: u2!.id, dono, gerenteU1, atendente }
}
const aviso = (unitId: string, o: Record<string, unknown> = {}) =>
  ({ unitId, data: DIA, pessoas: 3, horarioAprox: null, nome: null, ...o }) as Parameters<typeof criarAvisoPainel>[2]

describe('painel de avisos', () => {
  it('previsaoDoDia: totais só de ativos e não simulados, ordem do S1, incluirCancelados', async () => {
    const c = await cenario()
    const base = { restaurantId: c.restaurantId, data: DIA, origem: 'ia' as const }
    await db.insert(attendanceNotices).values([
      { ...base, unitId: c.u1, pessoas: 4 },
      { ...base, unitId: c.u1, pessoas: 2, status: 'cancelado' },
      { ...base, unitId: c.u1, pessoas: 9, simulado: true },
      { ...base, unitId: c.u2, pessoas: 5 },
      { ...base, unitId: c.u2, pessoas: 7, data: '2026-10-11' },
    ])
    const r = await previsaoDoDia(db, as(c.dono), { data: DIA, incluirCancelados: false })
    expect(r.map((x) => [x.unidade, x.totalPessoas, x.avisos.length])).toEqual([['Asa Norte', 5, 1], ['Asa Sul', 4, 1]])
    const r2 = await previsaoDoDia(db, as(c.dono), { data: DIA, incluirCancelados: true })
    expect(r2.map((x) => [x.unidade, x.totalPessoas, x.avisos.length])).toEqual([['Asa Norte', 5, 1], ['Asa Sul', 4, 2]])
  })

  it('gerente restrito vê só sua unidade; atendente lê; unidade inativa some', async () => {
    const c = await cenario()
    await db.insert(attendanceNotices).values([
      { restaurantId: c.restaurantId, unitId: c.u1, data: DIA, pessoas: 4, origem: 'ia' },
      { restaurantId: c.restaurantId, unitId: c.u2, data: DIA, pessoas: 5, origem: 'ia' },
    ])
    const g = await previsaoDoDia(db, as(c.gerenteU1), { data: DIA, incluirCancelados: false })
    expect(g.map((x) => x.unitId)).toEqual([c.u1])
    const a = await previsaoDoDia(db, as(c.atendente), { data: DIA, incluirCancelados: false })
    expect(a).toHaveLength(2)
    await db.update(units).set({ ativo: false }).where(eq(units.id, c.u2))
    expect((await previsaoDoDia(db, as(c.dono), { data: DIA, incluirCancelados: false })).map((x) => x.unitId)).toEqual([c.u1])
  })

  it('totalPrevistoHoje usa o dia no fuso do restaurante e respeita a unidade', async () => {
    const c = await cenario()
    await db.insert(attendanceNotices).values([
      { restaurantId: c.restaurantId, unitId: c.u1, data: DIA, pessoas: 4, origem: 'ia' },
      { restaurantId: c.restaurantId, unitId: c.u2, data: DIA, pessoas: 5, origem: 'ia' },
      { restaurantId: c.restaurantId, unitId: c.u2, data: DIA, pessoas: 8, origem: 'ia', simulado: true },
    ])
    // 11/10 01:00 UTC ainda é 10/10 em São Paulo
    const agora = new Date('2026-10-11T01:00:00Z')
    expect(await totalPrevistoHoje(db, as(c.dono), agora)).toBe(9)
    expect(await totalPrevistoHoje(db, as(c.gerenteU1), agora)).toBe(4)
    expect(await totalPrevistoHoje(db, as(c.dono), new Date('2026-10-12T15:00:00Z'))).toBe(0)
  })

  it('criar: dono e gerente ok, audit sem nome, origem painel, customer nulo', async () => {
    const c = await cenario()
    for (const [quem, unit] of [[c.dono, c.u2], [c.gerenteU1, c.u1]] as const) {
      const r = await criarAvisoPainel(db, as(quem), aviso(unit, { nome: 'Sr. João', horarioAprox: '20h' }))
      expect(r.ok).toBe(true)
      const id = r.ok ? r.valor.id : ''
      const [a] = await db.select().from(attendanceNotices).where(eq(attendanceNotices.id, id))
      expect(a).toMatchObject({ origem: 'painel', customerId: null, criadoPor: quem, nome: 'Sr. João', status: 'ativo', simulado: false })
      const [log] = await db.select().from(auditLog).where(eq(auditLog.entidadeId, id))
      expect(log).toMatchObject({ acao: 'aviso.criado_painel', atorId: quem })
      expect(JSON.stringify(log!.diff)).not.toContain('João')
      expect(log!.diff).not.toHaveProperty('nome')
    }
  })

  it('criar: atendente e gerente em outra unidade ⇒ sem_permissao', async () => {
    const c = await cenario()
    expect(await criarAvisoPainel(db, as(c.atendente), aviso(c.u1))).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(await criarAvisoPainel(db, as(c.gerenteU1), aviso(c.u2))).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(await db.select().from(attendanceNotices)).toHaveLength(0)
  })

  it('cancelar: audita; atendente ⇒ sem_permissao; inexistente ou já cancelado ⇒ nao_encontrada; outra unidade não cancela', async () => {
    const c = await cenario()
    const r = await criarAvisoPainel(db, as(c.dono), aviso(c.u2))
    const id = r.ok ? r.valor.id : ''
    expect(await cancelarAvisoPainel(db, as(c.atendente), id)).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(await cancelarAvisoPainel(db, as(c.gerenteU1), id)).toEqual({ ok: false, erro: 'nao_encontrada' })
    expect(await cancelarAvisoPainel(db, as(c.dono), id)).toEqual({ ok: true, valor: null })
    const [a] = await db.select().from(attendanceNotices).where(eq(attendanceNotices.id, id))
    expect(a!.status).toBe('cancelado')
    const logs = await db.select().from(auditLog).where(eq(auditLog.entidadeId, id))
    expect(logs.map((l) => l.acao).sort()).toEqual(['aviso.cancelado_painel', 'aviso.criado_painel'])
    expect(await cancelarAvisoPainel(db, as(c.dono), id)).toEqual({ ok: false, erro: 'nao_encontrada' })
    expect(await cancelarAvisoPainel(db, as(c.dono), '00000000-0000-4000-8000-000000000000')).toEqual({ ok: false, erro: 'nao_encontrada' })
  })
})
