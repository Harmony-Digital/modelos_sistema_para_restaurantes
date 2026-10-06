import { randomBytes } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { encryptPhone } from '@atd/core'
import { getTestDb, resetDb, seedRestaurant, seedStaff } from './test-utils.ts'
import type { JwtClaims } from './rls.ts'
import { acessoInbox, revelarTelefoneConversa } from './painel-conversas-acesso.ts'
import { auditLog, conversations, customers, staff, units } from './schema/index.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const KEY = randomBytes(32)
const as = (sub: string, aal: 'aal1' | 'aal2' = 'aal2'): JwtClaims => ({ sub, role: 'authenticated', aal })

async function cenario() {
  const a = await seedRestaurant(db)
  const [u2] = await db.insert(units).values({ restaurantId: a.restaurantId, nome: 'Norte', slug: 'norte' }).returning()
  const dono = await seedStaff(db, sql, { restaurantId: a.restaurantId, papel: 'dono' })
  const atendente = await seedStaff(db, sql, { restaurantId: a.restaurantId, papel: 'atendente' })
  await db.update(staff).set({ unidadesPermitidas: [a.unitId] }).where(eq(staff.userId, atendente))
  return { ...a, u2: u2!.id, dono, atendente }
}

async function conversa(restaurantId: string, unitId: string | null, simulada = false) {
  const [c] = await db.insert(customers).values({
    restaurantId, waIdHash: crypto.randomUUID(), telefoneCifrado: encryptPhone('+5561999990000', KEY), nomePerfil: 'Maria', simulado: simulada,
  }).returning()
  const [conv] = await db.insert(conversations).values({ restaurantId, customerId: c!.id, unidadeContextoId: unitId, simulada }).returning()
  return conv!.id
}

describe('acessoInbox', () => {
  it('dono vê todas as unidades; atendente restrito só as permitidas', async () => {
    const c = await cenario()
    const d = await acessoInbox(db, as(c.dono))
    expect(d).toMatchObject({ restaurantId: c.restaurantId, todas: true })
    expect(d!.unidades.map((u) => u.id).sort()).toEqual([c.unitId, c.u2].sort())
    expect(await acessoInbox(db, as(c.atendente, 'aal1'))).toEqual({
      restaurantId: c.restaurantId, todas: false, unidades: [{ id: c.unitId, nome: 'Asa Sul' }],
    })
  })
  it('dono sem MFA: null', async () => {
    const c = await cenario()
    expect(await acessoInbox(db, as(c.dono, 'aal1'))).toBeNull()
  })
})

describe('revelarTelefoneConversa', () => {
  it('conversa visível: devolve o número e audita sem o número', async () => {
    const c = await cenario()
    const id = await conversa(c.restaurantId, c.unitId)
    expect(await revelarTelefoneConversa(db, as(c.atendente, 'aal1'), id, KEY)).toEqual({ ok: true, valor: { telefone: '+5561999990000' } })
    const [a] = await db.select().from(auditLog).where(eq(auditLog.acao, 'conversa.telefone_visualizado'))
    expect(a).toMatchObject({ entidadeId: id, atorId: c.atendente })
    expect(JSON.stringify(a)).not.toContain('99999')
  })
  it('outra unidade, sem unidade ou simulada: nao_encontrada e nada auditado', async () => {
    const c = await cenario()
    for (const id of [await conversa(c.restaurantId, c.u2), await conversa(c.restaurantId, null)]) {
      expect(await revelarTelefoneConversa(db, as(c.atendente, 'aal1'), id, KEY)).toEqual({ ok: false, erro: 'nao_encontrada' })
    }
    const sim = await conversa(c.restaurantId, c.unitId, true)
    expect(await revelarTelefoneConversa(db, as(c.dono), sim, KEY)).toEqual({ ok: false, erro: 'nao_encontrada' })
    expect(await db.select().from(auditLog).where(eq(auditLog.acao, 'conversa.telefone_visualizado'))).toHaveLength(0)
  })
})
