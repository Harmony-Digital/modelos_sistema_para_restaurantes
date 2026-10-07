import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { getTestDb, resetDb, seedRestaurant, seedStaff } from './test-utils.ts'
import type { JwtClaims } from './rls.ts'
import { serieUltimos7Dias } from './painel-inicio.ts'
import { budgetCounters, conversations, customers, messages, restaurants, staff, units } from './schema/index.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const as = (sub: string, aal: 'aal1' | 'aal2' = 'aal2'): JwtClaims => ({ sub, role: 'authenticated', aal })
// 12:00 de 10/10/2026 em São Paulo: a série vai de 04/10 a 10/10
const AGORA = new Date('2026-10-10T15:00:00Z')
const DIAS = ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10']

async function cenario() {
  const a = await seedRestaurant(db)
  const [u2] = await db.insert(units).values({ restaurantId: a.restaurantId, nome: 'Asa Norte', slug: 'asa-norte' }).returning()
  const dono = await seedStaff(db, sql, { restaurantId: a.restaurantId, papel: 'dono' })
  const gerente = await seedStaff(db, sql, { restaurantId: a.restaurantId, papel: 'gerente' })
  await db.update(staff).set({ unidadesPermitidas: [a.unitId] }).where(eq(staff.userId, gerente))
  const atendente = await seedStaff(db, sql, { restaurantId: a.restaurantId, papel: 'atendente' })
  return { restaurantId: a.restaurantId, u1: a.unitId, u2: u2!.id, dono, gerente, atendente }
}
type Cenario = Awaited<ReturnType<typeof cenario>>

async function conversa(c: Cenario, p: { unitId: string; simulada?: boolean }) {
  const [cu] = await db.insert(customers).values({
    restaurantId: c.restaurantId, waIdHash: crypto.randomUUID(), telefoneCifrado: 'x', simulado: p.simulada ?? false,
  }).returning()
  const [cv] = await db.insert(conversations).values({
    restaurantId: c.restaurantId, customerId: cu!.id, estado: 'ia', unidadeContextoId: p.unitId, simulada: p.simulada ?? false,
  }).returning()
  return cv!.id
}

function mensagem(c: Cenario, conversationId: string, quando: string, direcao: 'in' | 'out' = 'in') {
  return db.insert(messages).values({
    restaurantId: c.restaurantId, conversationId, direcao, autor: direcao === 'in' ? 'cliente' : 'ia', tipo: 'texto', texto: 'oi',
    createdAt: new Date(quando),
  })
}

function gasto(c: Cenario, escopo: 'ia' | 'whatsapp' | 'simulacao', dia: string, valor: string, periodo: 'dia' | 'mes' = 'dia') {
  return db.insert(budgetCounters).values({ restaurantId: c.restaurantId, escopo, periodo, inicioPeriodo: dia, gasto: valor })
}

describe('serieUltimos7Dias', () => {
  it('sem movimento: sete dias zerados, do mais antigo para hoje (fuso do restaurante)', async () => {
    const c = await cenario()
    const s = await serieUltimos7Dias(db, as(c.dono), AGORA)
    expect(s).toEqual(DIAS.map((dia) => ({ dia, conversas: 0, gastoUsd: '0.000000' })))
  })

  it('conta conversas distintas com mensagem do cliente por dia local e soma o gasto diário da IA', async () => {
    const c = await cenario()
    const a = await conversa(c, { unitId: c.u1 })
    const b = await conversa(c, { unitId: c.u2 })
    await mensagem(c, a, '2026-10-10T13:00:00Z')
    await mensagem(c, a, '2026-10-10T14:00:00Z') // mesma conversa, mesmo dia: conta uma vez
    await mensagem(c, b, '2026-10-10T14:30:00Z')
    await mensagem(c, b, '2026-10-10T02:00:00Z') // 23:00 de 09/10 em São Paulo
    await mensagem(c, a, '2026-10-08T15:00:00Z', 'out') // resposta da IA não conta
    await mensagem(c, a, '2026-10-02T15:00:00Z') // fora da janela
    await gasto(c, 'ia', '2026-10-10', '0.120000')
    await gasto(c, 'ia', '2026-10-06', '1.500000')
    await gasto(c, 'whatsapp', '2026-10-10', '9.000000') // só IA
    await gasto(c, 'ia', '2026-10-01', '7.000000', 'mes') // mês não entra
    await gasto(c, 'ia', '2026-10-03', '5.000000') // fora da janela
    const s = await serieUltimos7Dias(db, as(c.dono), AGORA)
    expect(s.map((d) => d.conversas)).toEqual([0, 0, 0, 0, 0, 1, 2])
    expect(s.map((d) => d.gastoUsd)).toEqual(['0.000000', '0.000000', '1.500000', '0.000000', '0.000000', '0.000000', '0.120000'])
  })

  it('modo demonstração: conversas simuladas entram; o gasto do simulador nunca soma no "Gasto IA" (fica em Gastos, à parte)', async () => {
    const c = await cenario()
    const real = await conversa(c, { unitId: c.u1 })
    const sim = await conversa(c, { unitId: c.u1, simulada: true })
    await mensagem(c, real, '2026-10-10T13:00:00Z')
    await mensagem(c, sim, '2026-10-10T13:00:00Z')
    await gasto(c, 'ia', '2026-10-10', '0.100000')
    await gasto(c, 'simulacao', '2026-10-10', '0.050000')
    const desl = await serieUltimos7Dias(db, as(c.dono), AGORA)
    expect(desl.at(-1)).toEqual({ dia: '2026-10-10', conversas: 1, gastoUsd: '0.100000' })
    await db.update(restaurants).set({ modoDemonstracao: true }).where(eq(restaurants.id, c.restaurantId))
    const lig = await serieUltimos7Dias(db, as(c.dono), AGORA)
    expect(lig.at(-1)).toEqual({ dia: '2026-10-10', conversas: 2, gastoUsd: '0.100000' })
  })

  it('RLS: gerente restrito só conta a própria unidade; atendente não vê gasto; outro restaurante não aparece', async () => {
    const c = await cenario()
    await mensagem(c, await conversa(c, { unitId: c.u1 }), '2026-10-10T13:00:00Z')
    await mensagem(c, await conversa(c, { unitId: c.u2 }), '2026-10-10T13:00:00Z')
    await gasto(c, 'ia', '2026-10-10', '0.100000')
    // outro restaurante, mesmo dia
    const outro = await seedRestaurant(db)
    const c2 = { ...c, restaurantId: outro.restaurantId, u1: outro.unitId }
    await mensagem(c2, await conversa(c2, { unitId: outro.unitId }), '2026-10-10T13:00:00Z')
    await gasto(c2, 'ia', '2026-10-10', '3.000000')
    expect((await serieUltimos7Dias(db, as(c.dono), AGORA)).at(-1)).toEqual({ dia: '2026-10-10', conversas: 2, gastoUsd: '0.100000' })
    expect((await serieUltimos7Dias(db, as(c.gerente), AGORA)).at(-1)?.conversas).toBe(1)
    expect((await serieUltimos7Dias(db, as(c.atendente, 'aal1'), AGORA)).at(-1)?.gastoUsd).toBe('0.000000')
  })
})
