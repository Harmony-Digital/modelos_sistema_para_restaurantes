import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { encryptPhone } from '@atd/core'
import { eq } from 'drizzle-orm'
import { getTestDb, resetDb, seedRestaurant, seedStaff } from './test-utils.ts'
import type { JwtClaims } from './rls.ts'
import {
  cancelarAvisoPainel, criarAvisoPainel, mudarStatusReserva, previsaoDoDia, revelarContatoReserva, totalPrevistoHoje,
} from './painel-avisos.ts'
import { attendanceNotices, auditLog, customers, restaurants, staff, units } from './schema/index.ts'
import { TELEFONE_SIMULADO } from './simulador.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const as = (sub: string): JwtClaims => ({ sub, role: 'authenticated', aal: 'aal2' })
const DIA = '2026-10-10'
const ANTES = new Date('2026-10-05T15:00:00Z') // relógio fixo antes do DIA

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
      { ...base, unitId: c.u1, pessoas: 2, status: 'cancelada' },
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
      expect(a).toMatchObject({ origem: 'painel', customerId: null, criadoPor: quem, nome: 'Sr. João', status: 'confirmada', simulado: false })
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
    expect(await cancelarAvisoPainel(db, as(c.atendente), id, ANTES)).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(await cancelarAvisoPainel(db, as(c.gerenteU1), id, ANTES)).toEqual({ ok: false, erro: 'nao_encontrada' })
    expect(await cancelarAvisoPainel(db, as(c.dono), id, ANTES)).toEqual({ ok: true, valor: null })
    const [a] = await db.select().from(attendanceNotices).where(eq(attendanceNotices.id, id))
    expect(a!.status).toBe('cancelada')
    const logs = await db.select().from(auditLog).where(eq(auditLog.entidadeId, id))
    expect(logs.map((l) => l.acao).sort()).toEqual(['aviso.cancelado_painel', 'aviso.criado_painel'])
    expect(await cancelarAvisoPainel(db, as(c.dono), id, ANTES)).toEqual({ ok: false, erro: 'nao_encontrada' })
    expect(await cancelarAvisoPainel(db, as(c.dono), '00000000-0000-4000-8000-000000000000', ANTES)).toEqual({ ok: false, erro: 'nao_encontrada' })
  })

  it('cancelar: aviso de dia passado (fuso do restaurante) não é cancelado', async () => {
    const c = await cenario()
    const r = await criarAvisoPainel(db, as(c.dono), aviso(c.u2))
    const id = r.ok ? r.valor.id : ''
    // 11/10 02:00 UTC = 10/10 23:00 em São Paulo: ainda é o dia do aviso
    expect(await cancelarAvisoPainel(db, as(c.dono), id, new Date('2026-10-11T03:00:00Z'))).toEqual({ ok: false, erro: 'nao_encontrada' })
    const [a] = await db.select().from(attendanceNotices).where(eq(attendanceNotices.id, id))
    expect(a!.status).toBe('confirmada')
    expect(await cancelarAvisoPainel(db, as(c.dono), id, new Date('2026-10-11T02:00:00Z'))).toEqual({ ok: true, valor: null })
  })

  it('criar: passa pela lotação da unidade (reservas reais) e grava horário e contato', async () => {
    const c = await cenario()
    await db.update(units).set({ capacidadePessoas: 10 }).where(eq(units.id, c.u1))
    await db.insert(attendanceNotices).values([
      { restaurantId: c.restaurantId, unitId: c.u1, data: DIA, pessoas: 8, origem: 'ia' },
      { restaurantId: c.restaurantId, unitId: c.u1, data: DIA, pessoas: 8, origem: 'ia', simulado: true },
    ])
    expect(await criarAvisoPainel(db, as(c.dono), aviso(c.u1, { pessoas: 3 }))).toEqual({ ok: false, erro: 'lotado', vagas: 2 })
    const r = await criarAvisoPainel(db, as(c.gerenteU1), aviso(c.u1, { pessoas: 2, horario: '19:30', nome: 'Bia', contatoCifrado: 'cifrado' }))
    expect(r.ok).toBe(true)
    const [a] = await db.select().from(attendanceNotices).where(eq(attendanceNotices.id, r.ok ? r.valor.id : ''))
    expect(a).toMatchObject({ horario: '19:30:00', contatoCifrado: 'cifrado', status: 'confirmada' })
  })
})

describe('mudarStatusReserva', () => {
  const ANTES_DO_DIA = ANTES
  const NO_DIA = new Date('2026-10-10T15:00:00Z')
  async function comReserva(o: Partial<typeof attendanceNotices.$inferInsert> = {}) {
    const c = await cenario()
    const [r] = await db.insert(attendanceNotices).values({ restaurantId: c.restaurantId, unitId: c.u1, data: DIA, pessoas: 4, origem: 'ia', ...o }).returning()
    return { ...c, id: r!.id }
  }
  const status = async (id: string) => (await db.select().from(attendanceNotices).where(eq(attendanceNotices.id, id)))[0]!.status

  it('cancelada e não veio liberam vaga; reconfirmar passa pela lotação; tudo auditado sem PII', async () => {
    const c = await comReserva({ nome: 'Maria' })
    await db.update(units).set({ capacidadePessoas: 10 }).where(eq(units.id, c.u1))
    expect(await mudarStatusReserva(db, as(c.dono), c.id, 'cancelada', ANTES_DO_DIA)).toEqual({ ok: true, valor: null })
    expect(await status(c.id)).toBe('cancelada')
    // outra reserva ocupa a vaga liberada
    await db.insert(attendanceNotices).values({ restaurantId: c.restaurantId, unitId: c.u1, data: DIA, pessoas: 8, origem: 'painel' })
    expect(await mudarStatusReserva(db, as(c.dono), c.id, 'confirmada', ANTES_DO_DIA)).toEqual({ ok: false, erro: 'lotado', vagas: 2 })
    expect(await status(c.id)).toBe('cancelada')
    await db.update(units).set({ capacidadePessoas: 12 }).where(eq(units.id, c.u1))
    expect(await mudarStatusReserva(db, as(c.gerenteU1), c.id, 'confirmada', ANTES_DO_DIA)).toEqual({ ok: true, valor: null })
    expect(await mudarStatusReserva(db, as(c.dono), c.id, 'nao_veio', NO_DIA)).toEqual({ ok: true, valor: null })
    expect(await status(c.id)).toBe('nao_veio')
    const logs = await db.select().from(auditLog).where(eq(auditLog.entidadeId, c.id))
    expect(logs.map((l) => [l.acao, l.diff])).toEqual(expect.arrayContaining([
      ['reserva.status', { de: 'confirmada', para: 'cancelada' }],
      ['reserva.status', { de: 'cancelada', para: 'confirmada' }],
      ['reserva.status', { de: 'confirmada', para: 'nao_veio' }],
    ]))
    expect(logs).toHaveLength(3)
    expect(JSON.stringify(logs.map((l) => l.diff))).not.toContain('Maria')
  })

  it('mesmo status é nada; não veio só no dia ou depois; confirmar e cancelar só de hoje em diante', async () => {
    const c = await comReserva()
    expect(await mudarStatusReserva(db, as(c.dono), c.id, 'confirmada', ANTES_DO_DIA)).toEqual({ ok: true, valor: null })
    expect(await db.select().from(auditLog)).toHaveLength(0)
    expect(await mudarStatusReserva(db, as(c.dono), c.id, 'nao_veio', ANTES_DO_DIA)).toEqual({ ok: false, erro: 'transicao_invalida' })
    const depois = new Date('2026-10-12T15:00:00Z')
    expect(await mudarStatusReserva(db, as(c.dono), c.id, 'cancelada', depois)).toEqual({ ok: false, erro: 'transicao_invalida' })
    expect(await mudarStatusReserva(db, as(c.dono), c.id, 'nao_veio', depois)).toEqual({ ok: true, valor: null })
    expect(await mudarStatusReserva(db, as(c.dono), c.id, 'confirmada', depois)).toEqual({ ok: false, erro: 'transicao_invalida' })
  })

  it('atendente ⇒ sem_permissao; gerente de outra unidade ou inexistente ⇒ nao_encontrada', async () => {
    const c = await comReserva()
    const [outra] = await db.insert(attendanceNotices).values({ restaurantId: c.restaurantId, unitId: c.u2, data: DIA, pessoas: 2, origem: 'ia' }).returning()
    expect(await mudarStatusReserva(db, as(c.atendente), c.id, 'cancelada', ANTES_DO_DIA)).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(await mudarStatusReserva(db, as(c.gerenteU1), outra!.id, 'cancelada', ANTES_DO_DIA)).toEqual({ ok: false, erro: 'nao_encontrada' })
    expect(await mudarStatusReserva(db, as(c.dono), '00000000-0000-4000-8000-000000000000', 'cancelada', ANTES_DO_DIA))
      .toEqual({ ok: false, erro: 'nao_encontrada' })
    expect(await status(outra!.id)).toBe('confirmada')
  })

  it('reserva simulada só com o modo demonstração ligado; reconfirmar conta só os simulados', async () => {
    const c = await comReserva({ simulado: true, status: 'cancelada' })
    await db.update(units).set({ capacidadePessoas: 5 }).where(eq(units.id, c.u1))
    await db.insert(attendanceNotices).values({ restaurantId: c.restaurantId, unitId: c.u1, data: DIA, pessoas: 5, origem: 'painel' })
    expect(await mudarStatusReserva(db, as(c.dono), c.id, 'confirmada', ANTES_DO_DIA)).toEqual({ ok: false, erro: 'nao_encontrada' })
    await db.update(restaurants).set({ modoDemonstracao: true })
    expect(await mudarStatusReserva(db, as(c.dono), c.id, 'confirmada', ANTES_DO_DIA)).toEqual({ ok: true, valor: null })
  })

  it('reconfirmar quando o cliente já tem outra confirmada no mesmo dia ⇒ duplicada', async () => {
    const c = await comReserva({ status: 'cancelada' })
    const [cli] = await db.insert(customers).values({ restaurantId: c.restaurantId, waIdHash: 'h', telefoneCifrado: 'x' }).returning()
    await db.update(attendanceNotices).set({ customerId: cli!.id }).where(eq(attendanceNotices.id, c.id))
    await db.insert(attendanceNotices).values({ restaurantId: c.restaurantId, unitId: c.u1, customerId: cli!.id, data: DIA, pessoas: 2, origem: 'ia' })
    expect(await mudarStatusReserva(db, as(c.dono), c.id, 'confirmada', ANTES_DO_DIA)).toEqual({ ok: false, erro: 'duplicada' })
  })
})

describe('revelarContatoReserva', () => {
  const KEY = Buffer.alloc(32, 7)
  it('contato informado: decifra e audita sem o número; sem contato: o WhatsApp do cliente', async () => {
    const c = await cenario()
    const [cli] = await db.insert(customers).values({ restaurantId: c.restaurantId, waIdHash: 'h', telefoneCifrado: encryptPhone('5561988887777', KEY) }).returning()
    const [informado, whatsapp] = await db.insert(attendanceNotices).values([
      { restaurantId: c.restaurantId, unitId: c.u1, customerId: cli!.id, data: DIA, pessoas: 2, origem: 'ia', contatoCifrado: encryptPhone('5561999998888', KEY) },
      { restaurantId: c.restaurantId, unitId: c.u1, customerId: cli!.id, data: '2026-10-11', pessoas: 2, origem: 'ia' },
    ]).returning()
    expect(await revelarContatoReserva(db, as(c.atendente), informado!.id, KEY)).toEqual({ ok: true, valor: { telefone: '5561999998888', origem: 'informado' } })
    expect(await revelarContatoReserva(db, as(c.gerenteU1), whatsapp!.id, KEY)).toEqual({ ok: true, valor: { telefone: '5561988887777', origem: 'whatsapp' } })
    const logs = await db.select().from(auditLog)
    expect(logs.map((l) => [l.acao, l.entidadeId])).toEqual(expect.arrayContaining([
      ['reserva.contato_visualizado', informado!.id], ['reserva.contato_visualizado', whatsapp!.id],
    ]))
    expect(JSON.stringify(logs)).not.toMatch(/99999|88887/)
  })

  it('outra unidade, sem contato e sem cliente, ou cliente simulado ⇒ nao_encontrada, sem auditoria', async () => {
    const c = await cenario()
    const [sim] = await db.insert(customers).values({ restaurantId: c.restaurantId, waIdHash: 's', telefoneCifrado: TELEFONE_SIMULADO, simulado: true }).returning()
    await db.update(restaurants).set({ modoDemonstracao: true })
    const [outraUnidade, semNada, simulado] = await db.insert(attendanceNotices).values([
      { restaurantId: c.restaurantId, unitId: c.u2, data: DIA, pessoas: 2, origem: 'ia', contatoCifrado: encryptPhone('5561999998888', KEY) },
      { restaurantId: c.restaurantId, unitId: c.u1, data: DIA, pessoas: 2, origem: 'painel' },
      { restaurantId: c.restaurantId, unitId: c.u1, customerId: sim!.id, data: DIA, pessoas: 2, origem: 'ia', simulado: true },
    ]).returning()
    expect(await revelarContatoReserva(db, as(c.gerenteU1), outraUnidade!.id, KEY)).toEqual({ ok: false, erro: 'nao_encontrada' })
    expect(await revelarContatoReserva(db, as(c.dono), semNada!.id, KEY)).toEqual({ ok: false, erro: 'nao_encontrada' })
    expect(await revelarContatoReserva(db, as(c.dono), simulado!.id, KEY)).toEqual({ ok: false, erro: 'nao_encontrada' })
    expect(await db.select().from(auditLog)).toHaveLength(0)
  })
})
