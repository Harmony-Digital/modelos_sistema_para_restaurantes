import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { getTestDb, resetDb, seedRestaurant } from './test-utils.ts'
import { avisosAtivosDoCliente, cancelarAvisoDoCliente, registrarAviso, type GravarAviso } from './avisos.ts'
import { attendanceNotices, customers } from './schema/index.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

async function cliente(restaurantId: string, hash: string) {
  const [c] = await db.insert(customers).values({ restaurantId, waIdHash: hash, telefoneCifrado: 'x' }).returning({ id: customers.id })
  return c!.id
}
const base = (restaurantId: string, customerId: string, unitId: string, o: Partial<GravarAviso> = {}): GravarAviso => ({
  restaurantId, customerId, unitId, data: '2026-10-10', pessoas: 4, horarioAprox: '20h', nome: 'Ana', simulado: false, ...o,
})
const ativos = (customerId: string) =>
  db.select().from(attendanceNotices).where(and(eq(attendanceNotices.customerId, customerId), eq(attendanceNotices.status, 'ativo')))

describe('avisos do worker', () => {
  it('cria; o segundo registro do mesmo cliente/unidade/dia atualiza; após cancelar cria outro', async () => {
    const { restaurantId, unitId } = await seedRestaurant(db)
    const c = await cliente(restaurantId, 'h1')
    const a = await db.transaction((tx) => registrarAviso(tx, base(restaurantId, c, unitId)))
    expect(a.atualizado).toBe(false)
    const b = await db.transaction((tx) => registrarAviso(tx, base(restaurantId, c, unitId, { pessoas: 6, nome: null, horarioAprox: null })))
    expect(b).toEqual({ id: a.id, atualizado: true })
    const [linha] = await ativos(c)
    expect(linha).toMatchObject({ pessoas: 6, nome: 'Ana', horarioAprox: null, origem: 'ia', status: 'ativo' })
    expect(await db.transaction((tx) => cancelarAvisoDoCliente(tx, { restaurantId, customerId: c, avisoId: a.id }))).toBe(true)
    const d = await db.transaction((tx) => registrarAviso(tx, base(restaurantId, c, unitId)))
    expect(d.atualizado).toBe(false)
    expect(d.id).not.toBe(a.id)
    expect(await ativos(c)).toHaveLength(1)
  })

  it('concorrência: dois registros iguais em transações separadas deixam 1 ativo, sem erro', async () => {
    const { restaurantId, unitId } = await seedRestaurant(db)
    const c = await cliente(restaurantId, 'h1')
    const rs = await Promise.all([
      db.transaction((tx) => registrarAviso(tx, base(restaurantId, c, unitId))),
      db.transaction((tx) => registrarAviso(tx, base(restaurantId, c, unitId))),
    ])
    expect(rs[0].id).toBe(rs[1].id)
    expect(await ativos(c)).toHaveLength(1)
  })

  it('cancelar aviso de outro cliente devolve false e não muda nada', async () => {
    const { restaurantId, unitId } = await seedRestaurant(db)
    const c1 = await cliente(restaurantId, 'h1')
    const c2 = await cliente(restaurantId, 'h2')
    const a = await db.transaction((tx) => registrarAviso(tx, base(restaurantId, c1, unitId)))
    expect(await db.transaction((tx) => cancelarAvisoDoCliente(tx, { restaurantId, customerId: c2, avisoId: a.id }))).toBe(false)
    expect(await ativos(c1)).toHaveLength(1)
    // já cancelado ou inexistente também é false
    expect(await db.transaction((tx) => cancelarAvisoDoCliente(tx, { restaurantId, customerId: c1, avisoId: a.id }))).toBe(true)
    expect(await db.transaction((tx) => cancelarAvisoDoCliente(tx, { restaurantId, customerId: c1, avisoId: a.id }))).toBe(false)
  })

  it('avisosAtivosDoCliente ignora cancelados e datas anteriores', async () => {
    const { restaurantId, unitId } = await seedRestaurant(db)
    const c = await cliente(restaurantId, 'h1')
    const passado = await db.transaction((tx) => registrarAviso(tx, base(restaurantId, c, unitId, { data: '2026-10-01' })))
    const cancelado = await db.transaction((tx) => registrarAviso(tx, base(restaurantId, c, unitId, { data: '2026-10-11' })))
    await db.transaction((tx) => cancelarAvisoDoCliente(tx, { restaurantId, customerId: c, avisoId: cancelado.id }))
    const hoje = await db.transaction((tx) => registrarAviso(tx, base(restaurantId, c, unitId, { data: '2026-10-05' })))
    const futuro = await db.transaction((tx) => registrarAviso(tx, base(restaurantId, c, unitId, { data: '2026-10-12' })))
    const r = await avisosAtivosDoCliente(db, { restaurantId, customerId: c, aPartirDe: '2026-10-05' })
    expect(r.map((x) => x.id)).toEqual([hoje.id, futuro.id])
    expect(r.map((x) => x.id)).not.toContain(passado.id)
    expect(r[0]).toEqual({ id: hoje.id, unitId, data: '2026-10-05', pessoas: 4, horarioAprox: '20h' })
    // outro restaurante não enxerga
    const o = await seedRestaurant(db)
    expect(await avisosAtivosDoCliente(db, { restaurantId: o.restaurantId, customerId: c, aPartirDe: '2026-10-01' })).toEqual([])
  })

  it('rejeita pessoas fora de 1..60 e horário longo demais', async () => {
    const { restaurantId, unitId } = await seedRestaurant(db)
    const c = await cliente(restaurantId, 'h1')
    await expect(db.transaction((tx) => registrarAviso(tx, base(restaurantId, c, unitId, { pessoas: 0 })))).rejects.toThrow()
    await expect(db.transaction((tx) => registrarAviso(tx, base(restaurantId, c, unitId, { pessoas: 61 })))).rejects.toThrow()
    await expect(db.transaction((tx) => registrarAviso(tx, base(restaurantId, c, unitId, { horarioAprox: 'x'.repeat(41) })))).rejects.toThrow()
  })
})
