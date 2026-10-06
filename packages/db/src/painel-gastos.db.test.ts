import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { getTestDb, resetDb, seedRestaurant, seedStaff } from './test-utils.ts'
import type { JwtClaims } from './rls.ts'
import { lerLimites, relatorioMes, resumoGastos, salvarCotacao, salvarLimite } from './painel-gastos.ts'
import {
  aiRuns, auditLog, budgetAlerts, budgetCounters, budgetLimits, conversations, customers, restaurants, staff, units,
} from './schema/index.ts'
import { DEFAULT_BUDGET } from './bootstrap.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const as = (sub: string, aal: 'aal1' | 'aal2' = 'aal2'): JwtClaims => ({ sub, role: 'authenticated', aal })

async function cenario() {
  const { restaurantId, unitId } = await seedRestaurant(db)
  await db.insert(budgetLimits).values(DEFAULT_BUDGET.map((b) => ({ ...b, restaurantId })))
  const dono = await seedStaff(db, sql, { restaurantId, papel: 'dono' })
  const gerente = await seedStaff(db, sql, { restaurantId, papel: 'gerente' })
  const atendente = await seedStaff(db, sql, { restaurantId, papel: 'atendente' })
  return { restaurantId, unitId, dono, gerente, atendente }
}

describe('limites e cotação', () => {
  it('lerLimites: dono e gerente veem os seis limites (ordem fixa) e a cotação; atendente não vê limites', async () => {
    const c = await cenario()
    const r = await lerLimites(db, as(c.gerente))
    expect(r.cotacao).toBe('5.5000')
    expect(r.limites.map((l) => [l.escopo, l.periodo, l.limiteUsd, l.alertaPct])).toEqual([
      ['ia', 'dia', '2.000000', 80], ['ia', 'mes', '40.000000', 80],
      ['simulacao', 'dia', '1.000000', 80], ['simulacao', 'mes', '10.000000', 80],
      ['whatsapp', 'dia', '1.000000', 80], ['whatsapp', 'mes', '20.000000', 80],
    ])
    expect((await lerLimites(db, as(c.atendente, 'aal1'))).limites).toEqual([])
  })

  it('salvarLimite: só o dono; audita antigo e novo; valida valor e %; cria a linha se faltar', async () => {
    const c = await cenario()
    expect(await salvarLimite(db, as(c.dono), { escopo: 'ia', periodo: 'dia', limiteUsd: '0.5', alertaPct: 90 })).toEqual({ ok: true, valor: null })
    const [l] = await db.select().from(budgetLimits).where(eq(budgetLimits.escopo, 'ia')).orderBy(budgetLimits.periodo)
    expect(l).toMatchObject({ limiteUsd: '0.500000', alertaPct: 90 })
    const [log] = await db.select().from(auditLog).where(eq(auditLog.acao, 'orcamento.limite_alterado'))
    expect(log!.diff).toEqual({ escopo: 'ia', periodo: 'dia', de: { limiteUsd: '2.000000', alertaPct: 80 }, para: { limiteUsd: '0.5', alertaPct: 90 } })
    expect(await salvarLimite(db, as(c.gerente), { escopo: 'ia', periodo: 'dia', limiteUsd: '9', alertaPct: 80 })).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(await salvarLimite(db, as(c.atendente, 'aal1'), { escopo: 'ia', periodo: 'dia', limiteUsd: '9', alertaPct: 80 })).toEqual({ ok: false, erro: 'sem_permissao' })
    for (const v of [{ limiteUsd: '0', alertaPct: 80 }, { limiteUsd: '-1', alertaPct: 80 }, { limiteUsd: '1e3', alertaPct: 80 }, { limiteUsd: '1', alertaPct: 0 }, { limiteUsd: '1', alertaPct: 101 }, { limiteUsd: '1000001', alertaPct: 80 }]) {
      expect(await salvarLimite(db, as(c.dono), { escopo: 'ia', periodo: 'mes', ...v }), JSON.stringify(v)).toEqual({ ok: false, erro: 'valor_invalido' })
    }
    await db.delete(budgetLimits).where(eq(budgetLimits.escopo, 'simulacao'))
    expect(await salvarLimite(db, as(c.dono), { escopo: 'simulacao', periodo: 'mes', limiteUsd: '3', alertaPct: 75 })).toEqual({ ok: true, valor: null })
    const [sim] = await db.select().from(budgetLimits).where(eq(budgetLimits.escopo, 'simulacao'))
    expect(sim).toMatchObject({ periodo: 'mes', limiteUsd: '3.000000', alertaPct: 75 })
    const [log2] = await db.select().from(auditLog).where(eq(auditLog.entidadeId, sim!.id))
    expect(log2!.diff).toMatchObject({ de: null, para: { limiteUsd: '3', alertaPct: 75 } })
  })

  it('salvarCotacao: só o dono, entre 0,5 e 50, auditada', async () => {
    const c = await cenario()
    expect(await salvarCotacao(db, as(c.dono), '5.75')).toEqual({ ok: true, valor: null })
    const [r] = await db.select().from(restaurants)
    expect(r!.cotacaoUsdBrl).toBe('5.7500')
    for (const v of ['0.4', '51', 'abc', '5,5', '']) expect(await salvarCotacao(db, as(c.dono), v), v).toEqual({ ok: false, erro: 'valor_invalido' })
    expect(await salvarCotacao(db, as(c.gerente), '6')).toEqual({ ok: false, erro: 'sem_permissao' })
    const [log] = await db.select().from(auditLog).where(eq(auditLog.acao, 'orcamento.cotacao_alterada'))
    expect(log!.diff).toEqual({ de: '5.5000', para: '5.75' })
  })
})

describe('resumo de gastos', () => {
  it('hoje e mês por escopo no fuso do restaurante; só alertas do período corrente; atendente não vê', async () => {
    const c = await cenario()
    const agora = new Date('2026-10-01T02:00:00Z') // 30/09 23:00 em São Paulo
    await db.insert(budgetCounters).values([
      { restaurantId: c.restaurantId, escopo: 'ia', periodo: 'dia', inicioPeriodo: '2026-09-30', gasto: '0.25', reservado: '0.1' },
      { restaurantId: c.restaurantId, escopo: 'ia', periodo: 'mes', inicioPeriodo: '2026-09-01', gasto: '3.5' },
      { restaurantId: c.restaurantId, escopo: 'simulacao', periodo: 'dia', inicioPeriodo: '2026-09-30', gasto: '0.9' },
      { restaurantId: c.restaurantId, escopo: 'ia', periodo: 'dia', inicioPeriodo: '2026-10-01', gasto: '7' }, // dia seguinte em SP
    ])
    await db.insert(budgetAlerts).values([
      { restaurantId: c.restaurantId, escopo: 'simulacao', periodo: 'dia', inicioPeriodo: '2026-09-30', nivel: 80 },
      { restaurantId: c.restaurantId, escopo: 'ia', periodo: 'dia', inicioPeriodo: '2026-09-29', nivel: 100 }, // ontem
    ])
    const r = await resumoGastos(db, as(c.gerente), agora)
    expect(r.hoje).toEqual({ ia: '0.250000', simulacao: '0.900000', whatsapp: '0' })
    expect(r.mes).toEqual({ ia: '3.500000', simulacao: '0', whatsapp: '0' })
    expect(r.alertas).toEqual([
      { escopo: 'simulacao', periodo: 'dia', nivel: 80, inicioPeriodo: '2026-09-30', usoUsd: '0.900000', limiteUsd: '1.000000', criadoEm: expect.any(Date) },
    ])
    const at = await resumoGastos(db, as(c.atendente, 'aal1'), agora)
    expect(at).toEqual({ hoje: { ia: '0', simulacao: '0', whatsapp: '0' }, mes: { ia: '0', simulacao: '0', whatsapp: '0' }, alertas: [] })
  })
})

describe('relatório do mês', () => {
  it('agrega ai_runs do mês (fuso do restaurante): por dia × simulação, etapa, modelo, unidade e conversas reais', async () => {
    const c = await cenario()
    const [u2] = await db.insert(units).values({ restaurantId: c.restaurantId, nome: 'Asa Norte', slug: 'asa-norte' }).returning()
    const [cli] = await db.insert(customers).values({ restaurantId: c.restaurantId, waIdHash: 'h', telefoneCifrado: 'x' }).returning()
    const conv = async (unidade: string | null, estado: 'ia' | 'encerrada' = 'encerrada') =>
      (await db.insert(conversations).values({ restaurantId: c.restaurantId, customerId: cli!.id, unidadeContextoId: unidade, estado }).returning())[0]!.id
    const c1 = await conv(c.unitId)
    const c2 = await conv(u2!.id)
    const c3 = await conv(null, 'ia')
    const run = (o: Partial<typeof aiRuns.$inferInsert>) =>
      ({ restaurantId: c.restaurantId, etapa: 'triagem' as const, modelo: 'gpt-a', promptVersion: 'v', costUsd: '0.01', ...o })
    await db.insert(aiRuns).values([
      run({ conversationId: c1, createdAt: new Date('2026-10-01T03:30:00Z') }), // 01/10 00:30 SP
      run({ conversationId: c1, etapa: 'resposta', modelo: 'gpt-b', costUsd: '0.02', createdAt: new Date('2026-10-01T12:00:00Z') }),
      run({ conversationId: c2, costUsd: '0.04', createdAt: new Date('2026-10-02T12:00:00Z') }),
      run({ conversationId: c3, costUsd: '0.08', createdAt: new Date('2026-10-02T13:00:00Z') }),
      run({ conversationId: null, etapa: 'ingestao', modelo: 'gpt-b', costUsd: '0.16', createdAt: new Date('2026-10-02T14:00:00Z') }),
      run({ simulado: true, costUsd: '0.32', createdAt: new Date('2026-10-02T15:00:00Z') }),
      run({ costUsd: '9', createdAt: new Date('2026-10-01T02:59:00Z') }), // 30/09 23:59 SP: fora
      run({ costUsd: '9', createdAt: new Date('2026-11-01T03:00:00Z') }), // 01/11 00:00 SP: fora
    ])
    const r = await relatorioMes(db, as(c.gerente), '2026-10')
    expect(r.porDia).toEqual([
      { dia: '2026-10-01', realUsd: '0.030000', simulacaoUsd: '0' },
      { dia: '2026-10-02', realUsd: '0.280000', simulacaoUsd: '0.320000' },
    ])
    expect(r.porEtapa).toEqual([
      { etapa: 'ingestao', realUsd: '0.160000', simulacaoUsd: '0' },
      { etapa: 'resposta', realUsd: '0.020000', simulacaoUsd: '0' },
      { etapa: 'triagem', realUsd: '0.130000', simulacaoUsd: '0.320000' },
    ])
    expect(r.porModelo).toEqual([
      { modelo: 'gpt-a', realUsd: '0.130000', simulacaoUsd: '0.320000' },
      { modelo: 'gpt-b', realUsd: '0.180000', simulacaoUsd: '0' },
    ])
    expect(r.porUnidade).toEqual([
      { unitId: u2!.id, unidade: 'Asa Norte', realUsd: '0.040000' },
      { unitId: c.unitId, unidade: 'Asa Sul', realUsd: '0.030000' },
      { unitId: null, unidade: null, realUsd: '0.240000' },
    ])
    expect(r).toMatchObject({ totalRealUsd: '0.310000', totalSimulacaoUsd: '0.320000', conversasReais: 3 })
    // gerente restrito a uma unidade vê o custo do restaurante todo, sem jogar a outra unidade em "sem unidade"
    await db.update(staff).set({ unidadesPermitidas: [c.unitId] }).where(eq(staff.userId, c.gerente))
    expect((await relatorioMes(db, as(c.gerente), '2026-10')).porUnidade).toEqual(r.porUnidade)
    expect(await relatorioMes(db, as(c.dono, 'aal1'), '2026-10')).toMatchObject({ porUnidade: [], conversasReais: 0 })
    expect(await relatorioMes(db, as(c.atendente, 'aal1'), '2026-10')).toMatchObject({ porDia: [], totalRealUsd: '0', conversasReais: 0 })
  })

  it('mês inválido é recusado', async () => {
    const c = await cenario()
    for (const m of ['2026-13', '2026-1', 'x', '2026-10-01']) await expect(relatorioMes(db, as(c.dono), m), m).rejects.toThrow('mes_invalido')
  })
})
