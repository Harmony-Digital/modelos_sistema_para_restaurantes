import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { getTestDb, resetDb, seedRestaurant, seedStaff } from './test-utils.ts'
import type { JwtClaims } from './rls.ts'
import { listAwaitingHuman } from './conversations-panel.ts'
import { lerModoDemonstracao, modoDemonstracao, salvarModoDemonstracao } from './modo-demonstracao.ts'
import { cancelarAvisoPainel, previsaoDoDia, totalPrevistoHoje } from './painel-avisos.ts'
import { assumirConversa, contarAguardando, listarInbox, tempoAteAssumirHoje } from './painel-conversas.ts'
import { atualizarPedido, contarPedidosNovos, listarPedidos, revelarTelefonePedido } from './painel-eventos.ts'
import { getPanelStatus } from './panel.ts'
import { withUserContext } from './rls.ts'
import { taxaRespostaIa } from './s1.ts'
import { aiRuns, attendanceNotices, auditLog, conversations, customers, eventRequests, restaurants, staff, units } from './schema/index.ts'
import { TELEFONE_SIMULADO } from './simulador.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const as = (sub: string, aal: 'aal1' | 'aal2' = 'aal2'): JwtClaims => ({ sub, role: 'authenticated', aal })
const minutos = (m: number) => new Date(Date.now() - m * 60_000)
const DIA = '2026-10-10'
const NO_DIA = new Date('2026-10-10T15:00:00Z')

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
const ligar = (c: Cenario, v = true) => db.update(restaurants).set({ modoDemonstracao: v }).where(eq(restaurants.id, c.restaurantId))

async function conversa(c: Cenario, p: { unitId: string | null; simulada: boolean; estado?: 'ia' | 'aguardando_humano' | 'humano'; espera?: number }) {
  const [cu] = await db.insert(customers).values({
    restaurantId: c.restaurantId, waIdHash: crypto.randomUUID(), telefoneCifrado: p.simulada ? TELEFONE_SIMULADO : 'x', simulado: p.simulada,
  }).returning()
  const [cv] = await db.insert(conversations).values({
    restaurantId: c.restaurantId, customerId: cu!.id, estado: p.estado ?? 'aguardando_humano', unidadeContextoId: p.unitId,
    simulada: p.simulada, aguardandoDesde: minutos(p.espera ?? 1),
  }).returning()
  return { conversa: cv!.id, cliente: cu!.id }
}

describe('modo demonstração: leitura e escrita', () => {
  it('nasce desligado; toda a equipe lê', async () => {
    const c = await cenario()
    for (const quem of [as(c.dono), as(c.gerente), as(c.atendente, 'aal1')]) expect(await modoDemonstracao(db, quem)).toBe(false)
    await ligar(c)
    expect(await modoDemonstracao(db, as(c.atendente, 'aal1'))).toBe(true)
    expect(await withUserContext(db, as(c.gerente), (tx) => lerModoDemonstracao(tx))).toBe(true)
  })

  it('só o dono liga e desliga, com auditoria de antes e depois', async () => {
    const c = await cenario()
    expect(await salvarModoDemonstracao(db, as(c.gerente), c.restaurantId, true)).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(await salvarModoDemonstracao(db, as(c.atendente, 'aal1'), c.restaurantId, true)).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(await modoDemonstracao(db, as(c.dono))).toBe(false)
    expect(await salvarModoDemonstracao(db, as(c.dono), c.restaurantId, true)).toEqual({ ok: true, valor: null })
    expect(await modoDemonstracao(db, as(c.dono))).toBe(true)
    // repetir o mesmo valor não audita de novo
    expect(await salvarModoDemonstracao(db, as(c.dono), c.restaurantId, true)).toEqual({ ok: true, valor: null })
    expect(await salvarModoDemonstracao(db, as(c.dono), c.restaurantId, false)).toEqual({ ok: true, valor: null })
    const logs = await db.select().from(auditLog).where(eq(auditLog.acao, 'restaurante.modo_demonstracao')).orderBy(auditLog.id)
    expect(logs.map((l) => l.diff)).toEqual([{ de: false, para: true }, { de: true, para: false }])
    expect(logs.every((l) => l.atorId === c.dono && l.entidadeId === c.restaurantId)).toBe(true)
  })

  it('o dono sem MFA não muda; o gerente não consegue gravar direto na coluna (RLS)', async () => {
    const c = await cenario()
    expect((await salvarModoDemonstracao(db, as(c.dono, 'aal1'), c.restaurantId, true)).ok).toBe(false)
    await expect(withUserContext(db, as(c.gerente), (tx) =>
      tx.update(restaurants).set({ modoDemonstracao: true }).where(eq(restaurants.id, c.restaurantId))))
      .rejects.toMatchObject({ cause: { code: '42501' } })
    const [r] = await db.select({ m: restaurants.modoDemonstracao }).from(restaurants)
    expect(r!.m).toBe(false)
  })
})

describe('modo demonstração: Início', () => {
  it('conversas abertas, aguardando e lista de aguardando incluem simuladas só com o modo ligado', async () => {
    const c = await cenario()
    await conversa(c, { unitId: c.u1, simulada: false })
    await conversa(c, { unitId: c.u1, simulada: true })
    await conversa(c, { unitId: c.u2, simulada: true, estado: 'humano' })
    await conversa(c, { unitId: c.u1, simulada: true, estado: 'ia' })
    const desl = await getPanelStatus(db, as(c.dono))
    expect([desl.conversasAbertas, desl.aguardandoHumano]).toEqual([1, 1])
    expect((await listAwaitingHuman(db, as(c.dono))).map((i) => i.simulada)).toEqual([false])
    await ligar(c)
    const lig = await getPanelStatus(db, as(c.dono))
    expect([lig.conversasAbertas, lig.aguardandoHumano]).toEqual([4, 3])
    expect((await listAwaitingHuman(db, as(c.dono))).map((i) => i.simulada).sort()).toEqual([false, true, true])
    // RLS por unidade continua: gerente restrito à u1 não vê a simulada da u2
    expect((await listAwaitingHuman(db, as(c.gerente))).length).toBe(2)
  })

  it('previstos hoje, pedidos novos e taxa da IA incluem simulados só com o modo ligado', async () => {
    const c = await cenario()
    const base = { restaurantId: c.restaurantId, data: DIA, origem: 'ia' as const }
    await db.insert(attendanceNotices).values([
      { ...base, unitId: c.u1, pessoas: 4 },
      { ...base, unitId: c.u1, pessoas: 6, simulado: true },
      { ...base, unitId: c.u2, pessoas: 8, simulado: true },
    ])
    const ev = { restaurantId: c.restaurantId, data: '2026-11-20', convidados: 40, tipo: 'aniversario' as const }
    await db.insert(eventRequests).values([{ ...ev, unitId: c.u1 }, { ...ev, unitId: c.u1, simulado: true }, { ...ev, unitId: c.u2, simulado: true }])
    const run = { restaurantId: c.restaurantId, etapa: 'triagem' as const, modelo: 'm', promptVersion: 'triage-v2' }
    await db.insert(aiRuns).values([
      { ...run, itensValidos: 2, itensRespondidos: 1, createdAt: new Date('2026-10-10T10:00:00-03:00') },
      { ...run, itensValidos: 2, itensRespondidos: 2, simulado: true, createdAt: new Date('2026-10-10T11:00:00-03:00') },
    ])
    expect(await totalPrevistoHoje(db, as(c.dono), NO_DIA)).toBe(4)
    expect(await contarPedidosNovos(db, as(c.dono))).toBe(1)
    expect((await taxaRespostaIa(db, as(c.dono), NO_DIA)).hoje).toEqual({ validos: 2, respondidos: 1 })
    await ligar(c)
    expect(await totalPrevistoHoje(db, as(c.dono), NO_DIA)).toBe(18)
    expect(await totalPrevistoHoje(db, as(c.gerente), NO_DIA)).toBe(10)
    expect(await contarPedidosNovos(db, as(c.dono))).toBe(3)
    expect(await contarPedidosNovos(db, as(c.gerente))).toBe(2)
    expect((await taxaRespostaIa(db, as(c.dono), NO_DIA)).hoje).toEqual({ validos: 4, respondidos: 3 })
  })

  it('tempo até assumir conta as simuladas só com o modo ligado', async () => {
    const c = await cenario()
    const real = await conversa(c, { unitId: c.u1, simulada: false, espera: 2 })
    await assumirConversa(db, as(c.dono), real.conversa, {})
    const sim = await conversa(c, { unitId: c.u1, simulada: true, espera: 600 })
    await assumirConversa(db, as(c.dono), sim.conversa, {})
    const desl = await tempoAteAssumirHoje(db, as(c.dono))
    expect(desl).toBeGreaterThan(115)
    expect(desl).toBeLessThan(130)
    await ligar(c)
    const lig = await tempoAteAssumirHoje(db, as(c.dono))
    expect(lig).toBeGreaterThan(18_000) // mediana de 2 e 600 min
  })
})

describe('modo demonstração: Agenda e Conversas', () => {
  it('previsão do dia marca os simulados e só os mostra com o modo ligado', async () => {
    const c = await cenario()
    const base = { restaurantId: c.restaurantId, data: DIA, origem: 'ia' as const }
    await db.insert(attendanceNotices).values([{ ...base, unitId: c.u1, pessoas: 4 }, { ...base, unitId: c.u1, pessoas: 6, simulado: true }])
    const desl = await previsaoDoDia(db, as(c.dono), { data: DIA, incluirCancelados: false })
    expect(desl.find((u) => u.unitId === c.u1)!.avisos.map((a) => a.simulado)).toEqual([false])
    await ligar(c)
    const lig = await previsaoDoDia(db, as(c.dono), { data: DIA, incluirCancelados: false })
    const u1 = lig.find((u) => u.unitId === c.u1)!
    expect(u1.totalPessoas).toBe(10)
    expect(u1.avisos.map((a) => a.simulado).sort()).toEqual([false, true])
  })

  it('fila de eventos marca os simulados; mudar o status de um simulado funciona', async () => {
    const c = await cenario()
    const ev = { restaurantId: c.restaurantId, data: '2026-11-20', convidados: 40, tipo: 'aniversario' as const }
    const [, sim] = await db.insert(eventRequests).values([{ ...ev, unitId: c.u1 }, { ...ev, unitId: c.u1, simulado: true }]).returning()
    const f = { status: ['novo' as const], unitId: null }
    expect((await listarPedidos(db, as(c.dono), f)).map((p) => p.simulado)).toEqual([false])
    await ligar(c)
    expect((await listarPedidos(db, as(c.dono), f)).map((p) => p.simulado).sort()).toEqual([false, true])
    expect((await atualizarPedido(db, as(c.atendente, 'aal1'), sim!.id, { status: 'em_contato' })).ok).toBe(true)
    const [p] = await db.select({ s: eventRequests.status }).from(eventRequests).where(and(eq(eventRequests.id, sim!.id)))
    expect(p!.s).toBe('em_contato')
  })

  it('pedido simulado de outra unidade segue invisível; telefone de cliente simulado continua recusado', async () => {
    const c = await cenario()
    await ligar(c)
    const cli = await conversa(c, { unitId: c.u1, simulada: true })
    const ev = { restaurantId: c.restaurantId, data: '2026-11-20', convidados: 40, tipo: 'aniversario' as const, simulado: true }
    const [doU1, doU2] = await db.insert(eventRequests).values([{ ...ev, unitId: c.u1, customerId: cli.cliente }, { ...ev, unitId: c.u2 }]).returning()
    const f = { status: ['novo' as const], unitId: null }
    expect((await listarPedidos(db, as(c.gerente), f)).map((p) => p.id)).toEqual([doU1!.id])
    expect(await atualizarPedido(db, as(c.gerente), doU2!.id, { status: 'em_contato' })).toEqual({ ok: false, erro: 'nao_encontrada' })
    expect(await revelarTelefonePedido(db, as(c.dono), doU1!.id, Buffer.alloc(32))).toEqual({ ok: false, erro: 'nao_encontrada' })
  })

  it('cancelar aviso simulado funciona no modo ligado', async () => {
    const c = await cenario()
    await ligar(c)
    const [a] = await db.insert(attendanceNotices).values({
      restaurantId: c.restaurantId, unitId: c.u1, data: DIA, pessoas: 4, origem: 'ia', simulado: true,
    }).returning()
    expect(await cancelarAvisoPainel(db, as(c.gerente), a!.id, new Date('2026-10-09T15:00:00Z'))).toEqual({ ok: true, valor: null })
  })

  it('inbox e contador de aguardando incluem simuladas com o modo ligado, mesmo sem o filtro', async () => {
    const c = await cenario()
    await conversa(c, { unitId: c.u1, simulada: false })
    await conversa(c, { unitId: c.u1, simulada: true })
    await conversa(c, { unitId: c.u2, simulada: true })
    expect((await listarInbox(db, as(c.dono), { aba: 'aguardando' })).itens).toHaveLength(1)
    expect(await contarAguardando(db, as(c.dono))).toBe(1)
    await ligar(c)
    expect((await listarInbox(db, as(c.dono), { aba: 'aguardando' })).itens).toHaveLength(3)
    expect((await listarInbox(db, as(c.dono), { aba: 'aguardando', simulacoes: false })).itens).toHaveLength(3)
    expect(await contarAguardando(db, as(c.dono))).toBe(3)
    expect(await contarAguardando(db, as(c.atendente, 'aal1'))).toBe(3)
    expect(await contarAguardando(db, as(c.gerente))).toBe(2)
  })
})
