import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { getTestDb, resetDb, seedRestaurant } from './test-utils.ts'
import { withRole } from './rls.ts'
import { auditLog, budgetAlerts, budgetCounters, budgetLimits, spendLedger } from './schema/ops.ts'
import { liberarReservasPendentes, registrarAlertas, releaseBudget, reserveBudget, settleBudget } from './budget.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const TZ = 'America/Sao_Paulo'
const now = new Date('2026-10-05T15:00:00Z')

async function setup(dia: string, mes: string) {
  const { restaurantId } = await seedRestaurant(db)
  await db.insert(budgetLimits).values([
    { restaurantId, escopo: 'ia', periodo: 'dia', limiteUsd: dia },
    { restaurantId, escopo: 'ia', periodo: 'mes', limiteUsd: mes },
  ])
  return restaurantId
}

const counters = (restaurantId: string) =>
  db.select().from(budgetCounters).where(eq(budgetCounters.restaurantId, restaurantId)).orderBy(budgetCounters.periodo)

describe('orçamento', () => {
  it('sem limite configurado nega (fail closed)', async () => {
    const { restaurantId } = await seedRestaurant(db)
    expect(await reserveBudget(db, { restaurantId, scope: 'ia', amountUsd: '0.01', timeZone: TZ, now })).toBeNull()
  })

  it('reserva dentro do limite e registra no ledger', async () => {
    const restaurantId = await setup('1', '10')
    const r = await reserveBudget(db, { restaurantId, scope: 'ia', amountUsd: '0.05', timeZone: TZ, now, ref: 'teste' })
    expect(r?.counterIds).toHaveLength(2)
    expect((await counters(restaurantId)).map((c) => c.reservado)).toEqual(['0.050000', '0.050000'])
    const ledger = await db.select().from(spendLedger)
    expect(ledger.map((l) => [l.tipo, l.valorUsd])).toEqual([['reserva', '0.050000']])
  })

  it('tudo ou nada: mês estourado não deixa reserva pendurada no dia', async () => {
    const restaurantId = await setup('1', '0.03')
    expect(await reserveBudget(db, { restaurantId, scope: 'ia', amountUsd: '0.05', timeZone: TZ, now })).toBeNull()
    expect((await counters(restaurantId)).every((c) => c.reservado === '0.000000')).toBe(true)
  })

  it('100 reservas concorrentes nunca ultrapassam o teto', async () => {
    const restaurantId = await setup('1', '100')
    const results = await Promise.all(
      Array.from({ length: 100 }, () =>
        reserveBudget(db, { restaurantId, scope: 'ia', amountUsd: '0.02', timeZone: TZ, now }),
      ),
    )
    expect(results.filter(Boolean)).toHaveLength(50)
    const [dia, mes] = await counters(restaurantId)
    expect(dia!.reservado).toBe('1.000000')
    expect(mes!.reservado).toBe('1.000000')
  })

  it('liquidação troca reserva pelo custo real', async () => {
    const restaurantId = await setup('1', '10')
    const r = await reserveBudget(db, { restaurantId, scope: 'ia', amountUsd: '0.05', timeZone: TZ, now })
    await settleBudget(db, r!, '0.0123', 'run-1')
    const [dia] = await counters(restaurantId)
    expect([dia!.reservado, dia!.gasto]).toEqual(['0.000000', '0.012300'])
  })

  it('estorno devolve a reserva sem gasto', async () => {
    const restaurantId = await setup('1', '10')
    const r = await reserveBudget(db, { restaurantId, scope: 'ia', amountUsd: '0.05', timeZone: TZ, now })
    await releaseBudget(db, r!)
    const [dia] = await counters(restaurantId)
    expect([dia!.reservado, dia!.gasto]).toEqual(['0.000000', '0.000000'])
  })

  it('gasto do dia anterior não conta no dia seguinte', async () => {
    const restaurantId = await setup('0.05', '10')
    const r = await reserveBudget(db, { restaurantId, scope: 'ia', amountUsd: '0.05', timeZone: TZ, now })
    await settleBudget(db, r!, '0.05')
    const amanha = new Date('2026-10-06T15:00:00Z')
    expect(await reserveBudget(db, { restaurantId, scope: 'ia', amountUsd: '0.05', timeZone: TZ, now })).toBeNull()
    expect(await reserveBudget(db, { restaurantId, scope: 'ia', amountUsd: '0.05', timeZone: TZ, now: amanha })).not.toBeNull()
  })

  it('liquidar duas vezes é no-op', async () => {
    const restaurantId = await setup('1', '10')
    const r = await reserveBudget(db, { restaurantId, scope: 'ia', amountUsd: '0.05', timeZone: TZ, now })
    await settleBudget(db, r!, '0.01')
    await settleBudget(db, r!, '0.01')
    const [dia] = await counters(restaurantId)
    expect([dia!.reservado, dia!.gasto]).toEqual(['0.000000', '0.010000'])
    const ledger = await db.select().from(spendLedger)
    expect(ledger.filter((l) => l.tipo === 'liquidacao')).toHaveLength(1)
  })

  it('liquidar e depois estornar: estorno é no-op e não libera reserva alheia', async () => {
    const restaurantId = await setup('1', '10')
    const a = await reserveBudget(db, { restaurantId, scope: 'ia', amountUsd: '0.5', timeZone: TZ, now })
    await reserveBudget(db, { restaurantId, scope: 'ia', amountUsd: '0.5', timeZone: TZ, now })
    await settleBudget(db, a!, '0.1')
    await releaseBudget(db, a!)
    await releaseBudget(db, a!)
    const [dia] = await counters(restaurantId)
    expect([dia!.reservado, dia!.gasto]).toEqual(['0.500000', '0.100000'])
    expect(await reserveBudget(db, { restaurantId, scope: 'ia', amountUsd: '0.5', timeZone: TZ, now })).toBeNull()
  })

  it('valores inválidos lançam sem escrever', async () => {
    const restaurantId = await setup('1', '10')
    for (const amountUsd of ['-1', '0', 'abc', '0.0000001']) {
      await expect(reserveBudget(db, { restaurantId, scope: 'ia', amountUsd, timeZone: TZ, now })).rejects.toThrow(
        'Valor em USD inválido',
      )
    }
    const r = await reserveBudget(db, { restaurantId, scope: 'ia', amountUsd: '0.05', timeZone: TZ, now })
    await expect(settleBudget(db, r!, '-0.01')).rejects.toThrow('Valor em USD inválido')
    expect(await db.select().from(spendLedger)).toHaveLength(1)
  })

  it('linhas de liquidação carregam reserva_id', async () => {
    const restaurantId = await setup('1', '10')
    const r = await reserveBudget(db, { restaurantId, scope: 'ia', amountUsd: '0.05', timeZone: TZ, now })
    await settleBudget(db, r!, '0.01')
    const ledger = await db.select().from(spendLedger).orderBy(spendLedger.id)
    expect(ledger[1]!.tipo).toBe('liquidacao')
    expect(ledger[1]!.reservaId).toBe(r!.reservationId)
    expect(ledger[0]!.id).toBe(r!.reservationId)
  })

  it('liberarReservasPendentes: devolve só as reservas do ref ainda abertas (processo que morreu), uma vez só', async () => {
    const restaurantId = await setup('1', '10')
    const ref = 'importacao:x'
    // relógio real: o ledger grava now() do banco e a liberação acha os contadores pelo período desse instante
    await reserveBudget(db, { restaurantId, scope: 'ia', amountUsd: '0.50', timeZone: TZ, ref })
    const liquidada = await reserveBudget(db, { restaurantId, scope: 'ia', amountUsd: '0.20', timeZone: TZ, ref })
    await settleBudget(db, liquidada!, '0.01', ref)
    await reserveBudget(db, { restaurantId, scope: 'ia', amountUsd: '0.10', timeZone: TZ, ref: 'outro' })
    expect((await counters(restaurantId)).map((c) => c.reservado)).toEqual(['0.600000', '0.600000'])

    expect(await withRole(db, 'worker_app', (tx) => liberarReservasPendentes(tx, { restaurantId, ref, timeZone: TZ }))).toBe(1)
    expect((await counters(restaurantId)).map((c) => [c.reservado, c.gasto])).toEqual([['0.100000', '0.010000'], ['0.100000', '0.010000']])
    expect(await liberarReservasPendentes(db, { restaurantId, ref, timeZone: TZ })).toBe(0)
    expect((await counters(restaurantId)).map((c) => c.reservado)).toEqual(['0.100000', '0.100000'])
  })

  it('liberarReservasPendentes com liquidarUsd: liquida a reserva aberta por esse valor (chamada talvez cobrada)', async () => {
    const restaurantId = await setup('1', '10')
    const ref = 'importacao:y'
    await reserveBudget(db, { restaurantId, scope: 'ia', amountUsd: '0.50', timeZone: TZ, ref })
    expect(await withRole(db, 'worker_app', (tx) => liberarReservasPendentes(tx, { restaurantId, ref, timeZone: TZ, liquidarUsd: '0.10' }))).toBe(1)
    expect((await counters(restaurantId)).map((c) => [c.reservado, c.gasto])).toEqual([['0.000000', '0.100000'], ['0.000000', '0.100000']])
    const baixas = await db.select().from(spendLedger).where(eq(spendLedger.tipo, 'liquidacao'))
    expect(baixas).toHaveLength(1)
    expect(await liberarReservasPendentes(db, { restaurantId, ref, timeZone: TZ, liquidarUsd: '0.10' })).toBe(0)
  })
})


describe('alertas de gasto (registrarAlertas)', () => {
  // 2026-10-05 12:00 em São Paulo: dia 2026-10-05, mês 2026-10-01
  async function comLimites(escopo: 'ia' | 'simulacao' = 'ia') {
    const { restaurantId } = await seedRestaurant(db)
    await db.insert(budgetLimits).values([
      { restaurantId, escopo, periodo: 'dia', limiteUsd: '1', alertaPct: 80 },
      { restaurantId, escopo, periodo: 'mes', limiteUsd: '10', alertaPct: 50 },
    ])
    return restaurantId
  }
  async function contador(restaurantId: string, periodo: 'dia' | 'mes', gasto: string, reservado = '0', escopo: 'ia' | 'simulacao' = 'ia') {
    const inicio = periodo === 'dia' ? '2026-10-05' : '2026-10-01'
    await db.insert(budgetCounters).values({ restaurantId, escopo, periodo, inicioPeriodo: inicio, gasto, reservado })
      .onConflictDoUpdate({ target: [budgetCounters.restaurantId, budgetCounters.escopo, budgetCounters.periodo, budgetCounters.inicioPeriodo], set: { gasto, reservado } })
  }
  const alertas = () => db.select().from(budgetAlerts).orderBy(budgetAlerts.periodo, budgetAlerts.nivel)
  const registrar = (restaurantId: string, escopo: 'ia' | 'simulacao' = 'ia') =>
    withRole(db, 'worker_app', (tx) => registrarAlertas(tx, { restaurantId, escopo, agora: now }))

  it('abaixo do limiar não grava; cruzar alerta_pct grava 80; atingir o limite grava 100; cada nível uma vez só', async () => {
    const rid = await comLimites()
    await contador(rid, 'dia', '0.5', '0.29')
    expect(await registrar(rid)).toEqual([])
    await contador(rid, 'dia', '0.5', '0.30') // gasto + reservado = 80%
    expect(await registrar(rid)).toEqual([80])
    expect(await registrar(rid)).toEqual([])
    await contador(rid, 'dia', '1', '0')
    expect(await registrar(rid)).toEqual([100])
    expect(await registrar(rid)).toEqual([])
    expect((await alertas()).map((a) => [a.periodo, a.inicioPeriodo, a.nivel])).toEqual([['dia', '2026-10-05', 80], ['dia', '2026-10-05', 100]])
    const audit = await db.select().from(auditLog).where(eq(auditLog.acao, 'orcamento.alerta')).orderBy(auditLog.id)
    expect(audit.map((l) => [l.atorTipo, l.diff])).toEqual([
      ['sistema', { escopo: 'ia', periodo: 'dia', inicioPeriodo: '2026-10-05', nivel: 80 }],
      ['sistema', { escopo: 'ia', periodo: 'dia', inicioPeriodo: '2026-10-05', nivel: 100 }],
    ])
  })

  it('pular direto para 100% grava 80 e 100 de uma vez; mês com alerta_pct próprio', async () => {
    const rid = await comLimites()
    await contador(rid, 'dia', '1.2')
    await contador(rid, 'mes', '5')
    expect((await registrar(rid)).sort()).toEqual([100, 80, 80].sort())
    expect((await alertas()).map((a) => [a.periodo, a.nivel])).toEqual([['dia', 80], ['dia', 100], ['mes', 80]])
  })

  it('escopos separados: simulação não gera alerta de IA; sem limite não grava', async () => {
    const rid = await comLimites('simulacao')
    await contador(rid, 'dia', '1', '0', 'simulacao')
    expect(await registrar(rid, 'ia')).toEqual([])
    expect((await registrar(rid, 'simulacao')).sort()).toEqual([100, 80])
    expect((await alertas()).every((a) => a.escopo === 'simulacao')).toBe(true)
  })

  it('período anterior não conta: contador de ontem não gera alerta hoje', async () => {
    const rid = await comLimites()
    await db.insert(budgetCounters).values({ restaurantId: rid, escopo: 'ia', periodo: 'dia', inicioPeriodo: '2026-10-04', gasto: '5' })
    expect(await registrar(rid)).toEqual([])
  })

  it('concorrência: duas transações cruzando juntas gravam o nível uma vez só', async () => {
    const rid = await comLimites()
    await contador(rid, 'dia', '0.9')
    const rs = await Promise.all([registrar(rid), registrar(rid), registrar(rid)])
    expect(rs.flat()).toEqual([80])
    expect(await alertas()).toHaveLength(1)
    expect(await db.select().from(auditLog).where(eq(auditLog.acao, 'orcamento.alerta'))).toHaveLength(1)
  })
})

describe('alertas na reserva e na liquidação', () => {
  async function comLimites(escopo: 'ia' | 'simulacao', dia: string, mes = '100') {
    const { restaurantId } = await seedRestaurant(db)
    await db.insert(budgetLimits).values([
      { restaurantId, escopo, periodo: 'dia', limiteUsd: dia, alertaPct: 80 },
      { restaurantId, escopo, periodo: 'mes', limiteUsd: mes, alertaPct: 80 },
    ])
    return restaurantId
  }
  const niveis = async () =>
    (await db.select().from(budgetAlerts).orderBy(budgetAlerts.periodo, budgetAlerts.nivel)).map((a) => [a.escopo, a.periodo, a.nivel])

  it('reserva que cruza 80% grava o alerta junto (gasto + reservado)', async () => {
    const rid = await comLimites('ia', '1')
    await reserveBudget(db, { restaurantId: rid, scope: 'ia', amountUsd: '0.5', timeZone: TZ, now })
    expect(await niveis()).toEqual([])
    await reserveBudget(db, { restaurantId: rid, scope: 'ia', amountUsd: '0.3', timeZone: TZ, now })
    expect(await niveis()).toEqual([['ia', 'dia', 80]])
    expect(await db.select().from(auditLog).where(eq(auditLog.acao, 'orcamento.alerta'))).toHaveLength(1)
  })

  it('liquidação que leva o gasto ao limite grava 100 (no período da reserva)', async () => {
    const rid = await comLimites('simulacao', '1')
    const r = await reserveBudget(db, { restaurantId: rid, scope: 'simulacao', amountUsd: '0.5', timeZone: TZ, now })
    expect(await niveis()).toEqual([])
    await settleBudget(db, r!, '1')
    expect(await niveis()).toEqual([['simulacao', 'dia', 80], ['simulacao', 'dia', 100]])
  })

  it('dono baixa o limite abaixo do já gasto: a reserva é recusada e o alerta de 100% aparece', async () => {
    const rid = await comLimites('ia', '1')
    const r = await reserveBudget(db, { restaurantId: rid, scope: 'ia', amountUsd: '0.4', timeZone: TZ, now })
    await settleBudget(db, r!, '0.4')
    await db.update(budgetLimits).set({ limiteUsd: '0.3' }).where(eq(budgetLimits.periodo, 'dia'))
    expect(await reserveBudget(db, { restaurantId: rid, scope: 'ia', amountUsd: '0.01', timeZone: TZ, now })).toBeNull()
    expect(await niveis()).toEqual([['ia', 'dia', 80], ['ia', 'dia', 100]])
    // a recusa não deixa reserva pendurada
    expect((await counters(rid)).map((c) => c.reservado)).toEqual(['0.000000', '0.000000'])
  })

  it('recusa entre o limiar e 100%: grava também o 100% (a IA parou), não só o 80%', async () => {
    const rid = await comLimites('ia', '1')
    const r = await reserveBudget(db, { restaurantId: rid, scope: 'ia', amountUsd: '0.995', timeZone: TZ, now })
    await settleBudget(db, r!, '0.995')
    expect(await niveis()).toEqual([['ia', 'dia', 80]])
    expect(await reserveBudget(db, { restaurantId: rid, scope: 'ia', amountUsd: '0.01', timeZone: TZ, now })).toBeNull()
    expect(await niveis()).toEqual([['ia', 'dia', 80], ['ia', 'dia', 100]])
  })

  it('falha ao gravar o alerta na recusa não vira erro da reserva: devolve null e avisa quem chamou', async () => {
    const rid = await comLimites('ia', '0.001')
    const erros: unknown[] = []
    let n = 0
    const falho = new Proxy(db, {
      get(alvo, prop, rec) {
        // a 1ª transação (reserva) segue; a 2ª (alerta da recusa) falha como um deadlock
        if (prop === 'transaction') {
          return (fn: (tx: unknown) => unknown) => (n++ === 0 ? alvo.transaction(fn as never) : Promise.reject(new Error('deadlock detected')))
        }
        return Reflect.get(alvo, prop, rec)
      },
    })
    expect(await reserveBudget(falho, {
      restaurantId: rid, scope: 'ia', amountUsd: '0.01', timeZone: TZ, now, aoFalharAlerta: (e) => erros.push(e),
    })).toBeNull()
    expect(erros).toHaveLength(1)
  })

  it('estresse do teto com alertas: 20 reservas concorrentes da simulação nunca passam do limite', async () => {
    const rid = await comLimites('simulacao', '0.1')
    const rs = await Promise.all(Array.from({ length: 20 }, () =>
      reserveBudget(db, { restaurantId: rid, scope: 'simulacao', amountUsd: '0.01', timeZone: TZ, now })))
    expect(rs.filter(Boolean)).toHaveLength(10)
    const [dia] = await counters(rid)
    expect(dia!.reservado).toBe('0.100000')
    expect(await niveis()).toEqual([['simulacao', 'dia', 80], ['simulacao', 'dia', 100]])
    expect(await db.select().from(auditLog).where(eq(auditLog.acao, 'orcamento.alerta'))).toHaveLength(2)
  })
})
