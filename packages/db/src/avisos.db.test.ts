import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { getTestDb, resetDb, seedRestaurant } from './test-utils.ts'
import { avisosAtivosDoCliente, cancelarAvisoDoCliente } from './avisos.ts'
import { attendanceNotices, customers } from './schema/index.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

async function cliente(restaurantId: string, hash: string) {
  const [c] = await db.insert(customers).values({ restaurantId, waIdHash: hash, telefoneCifrado: 'x' }).returning({ id: customers.id })
  return c!.id
}
/** Reserva confirmada do cliente (insert direto: a gravação com lotação é testada em `reserva-lotacao.db.test.ts`). */
type Aviso = Partial<typeof attendanceNotices.$inferInsert>
async function inserir(restaurantId: string, customerId: string, unitId: string, o: Aviso = {}) {
  const [a] = await db.insert(attendanceNotices).values({
    restaurantId, customerId, unitId, data: '2026-10-10', pessoas: 4, horarioAprox: '20h', nome: 'Ana', origem: 'ia', ...o,
  }).returning({ id: attendanceNotices.id })
  return a!
}
const ativos = (customerId: string) =>
  db.select().from(attendanceNotices).where(and(eq(attendanceNotices.customerId, customerId), eq(attendanceNotices.status, 'confirmada')))

describe('avisos do worker', () => {
  it('cancelar aviso de outro cliente devolve false e não muda nada', async () => {
    const { restaurantId, unitId } = await seedRestaurant(db)
    const c1 = await cliente(restaurantId, 'h1')
    const c2 = await cliente(restaurantId, 'h2')
    const a = await inserir(restaurantId, c1, unitId)
    expect(await db.transaction((tx) => cancelarAvisoDoCliente(tx, { restaurantId, customerId: c2, avisoId: a.id }))).toBe(false)
    expect(await ativos(c1)).toHaveLength(1)
    // já cancelado ou inexistente também é false
    expect(await db.transaction((tx) => cancelarAvisoDoCliente(tx, { restaurantId, customerId: c1, avisoId: a.id }))).toBe(true)
    expect(await db.transaction((tx) => cancelarAvisoDoCliente(tx, { restaurantId, customerId: c1, avisoId: a.id }))).toBe(false)
  })

  it('avisosAtivosDoCliente ignora cancelados e datas anteriores', async () => {
    const { restaurantId, unitId } = await seedRestaurant(db)
    const c = await cliente(restaurantId, 'h1')
    const passado = await inserir(restaurantId, c, unitId, { data: '2026-10-01' })
    const cancelado = await inserir(restaurantId, c, unitId, { data: '2026-10-11' })
    await db.transaction((tx) => cancelarAvisoDoCliente(tx, { restaurantId, customerId: c, avisoId: cancelado.id }))
    const hoje = await inserir(restaurantId, c, unitId, { data: '2026-10-05' })
    const futuro = await inserir(restaurantId, c, unitId, { data: '2026-10-12' })
    const r = await avisosAtivosDoCliente(db, { restaurantId, customerId: c, aPartirDe: '2026-10-05' })
    expect(r.map((x) => x.id)).toEqual([hoje.id, futuro.id])
    expect(r.map((x) => x.id)).not.toContain(passado.id)
    expect(r[0]).toEqual({
      id: hoje.id, unitId, data: '2026-10-05', pessoas: 4, horarioAprox: '20h', horario: null, nome: 'Ana', temContatoProprio: false,
    })
    // outro restaurante não enxerga
    const o = await seedRestaurant(db)
    expect(await avisosAtivosDoCliente(db, { restaurantId: o.restaurantId, customerId: c, aPartirDe: '2026-10-01' })).toEqual([])
  })

  it('rejeita pessoas fora de 1..60 e horário longo demais', async () => {
    const { restaurantId, unitId } = await seedRestaurant(db)
    const c = await cliente(restaurantId, 'h1')
    await expect(inserir(restaurantId, c, unitId, { pessoas: 0 })).rejects.toThrow()
    await expect(inserir(restaurantId, c, unitId, { pessoas: 61 })).rejects.toThrow()
    await expect(inserir(restaurantId, c, unitId, { horarioAprox: 'x'.repeat(41) })).rejects.toThrow()
  })

  it('avisosAtivosDoCliente devolve horário, nome e só se há contato próprio (nunca o contato cifrado)', async () => {
    const { restaurantId, unitId } = await seedRestaurant(db)
    const c = await cliente(restaurantId, 'h1')
    await db.insert(attendanceNotices).values({
      restaurantId, unitId, customerId: c, data: '2026-10-10', pessoas: 3, horario: '19:30', nome: 'Bia', contatoCifrado: 'cifrado', origem: 'ia',
    })
    const [r] = await avisosAtivosDoCliente(db, { restaurantId, customerId: c, aPartirDe: '2026-10-01' })
    expect(r).toMatchObject({ horario: '19:30:00', nome: 'Bia', temContatoProprio: true })
    expect(JSON.stringify(r)).not.toContain('cifrado')
  })
})
