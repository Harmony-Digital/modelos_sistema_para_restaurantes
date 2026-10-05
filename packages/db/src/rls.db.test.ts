import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql as dsql } from 'drizzle-orm'
import { getTestDb, resetDb, seedRestaurant, seedStaff } from './test-utils.ts'
import { withRole, withUserContext, type JwtClaims } from './rls.ts'
import { auditLog, budgetLimits, conversations, customers, messages, restaurants } from './schema/index.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const as = (sub: string, aal: 'aal1' | 'aal2'): JwtClaims => ({ sub, role: 'authenticated', aal })
const cause = (re: RegExp) => ({ cause: { message: expect.stringMatching(re) } })

describe('RLS', () => {
  it('toda tabela de public tem RLS habilitada', async () => {
    const rows = await sql<{ relname: string }[]>`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`
    expect(rows.map((r) => r.relname)).toEqual([])
  })

  it('dono sem MFA (aal1) não vê nada; com aal2 vê o próprio restaurante', async () => {
    const { restaurantId } = await seedRestaurant(db)
    const dono = await seedStaff(db, sql, { restaurantId, papel: 'dono' })
    const semMfa = await withUserContext(db, as(dono, 'aal1'), (tx) => tx.select().from(restaurants))
    const comMfa = await withUserContext(db, as(dono, 'aal2'), (tx) => tx.select().from(restaurants))
    expect(semMfa).toHaveLength(0)
    expect(comMfa.map((r) => r.id)).toEqual([restaurantId])
  })

  it('atendente vê conversas do próprio restaurante e não de outro', async () => {
    const a = await seedRestaurant(db)
    const b = await seedRestaurant(db)
    const atendente = await seedStaff(db, sql, { restaurantId: a.restaurantId, papel: 'atendente' })
    for (const r of [a, b]) {
      const [c] = await db.insert(customers).values({ restaurantId: r.restaurantId, waIdHash: r.restaurantId, telefoneCifrado: 'x' }).returning()
      await db.insert(conversations).values({ restaurantId: r.restaurantId, customerId: c!.id })
    }
    const rows = await withUserContext(db, as(atendente, 'aal1'), (tx) => tx.select().from(conversations))
    expect(rows.map((r) => r.restaurantId)).toEqual([a.restaurantId])
  })

  it('atendente não lê limites de gasto; gerente não altera', async () => {
    const { restaurantId } = await seedRestaurant(db)
    await db.insert(budgetLimits).values({ restaurantId, escopo: 'ia', periodo: 'dia', limiteUsd: '5' })
    const atendente = await seedStaff(db, sql, { restaurantId, papel: 'atendente' })
    const gerente = await seedStaff(db, sql, { restaurantId, papel: 'gerente' })
    const lidos = await withUserContext(db, as(atendente, 'aal1'), (tx) => tx.select().from(budgetLimits))
    expect(lidos).toHaveLength(0)
    await expect(
      withUserContext(db, as(gerente, 'aal2'), (tx) =>
        tx.insert(budgetLimits).values({ restaurantId, escopo: 'ia', periodo: 'mes', limiteUsd: '50' }),
      ),
    ).rejects.toMatchObject(cause(/row-level security/))
  })

  it('audit_log é append-only até para o dono', async () => {
    const { restaurantId } = await seedRestaurant(db)
    const dono = await seedStaff(db, sql, { restaurantId, papel: 'dono' })
    await db.insert(auditLog).values({ restaurantId, atorTipo: 'sistema', acao: 'teste', entidade: 'x' })
    await expect(
      withUserContext(db, as(dono, 'aal2'), (tx) => tx.update(auditLog).set({ acao: 'adulterado' })),
    ).rejects.toMatchObject(cause(/permission denied/))
    await expect(withRole(db, 'worker_app', (tx) => tx.delete(auditLog))).rejects.toMatchObject(cause(/permission denied/))
  })

  it('worker_app grava mensagens mas não apaga', async () => {
    const { restaurantId } = await seedRestaurant(db)
    const [c] = await db.insert(customers).values({ restaurantId, waIdHash: 'h', telefoneCifrado: 'x' }).returning()
    const [conv] = await db.insert(conversations).values({ restaurantId, customerId: c!.id }).returning()
    await withRole(db, 'worker_app', (tx) =>
      tx.insert(messages).values({ restaurantId, conversationId: conv!.id, direcao: 'out', autor: 'ia', tipo: 'texto', texto: 'ok' }),
    )
    await expect(withRole(db, 'worker_app', (tx) => tx.delete(messages))).rejects.toMatchObject(cause(/permission denied/))
  })

  it('anon não acessa nada', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(dsql`set local role anon`)
        return tx.select().from(restaurants)
      }),
    ).rejects.toMatchObject(cause(/permission denied/))
  })
})
