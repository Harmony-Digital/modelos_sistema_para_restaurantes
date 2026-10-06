import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { encryptPhone } from '@atd/core'
import { getTestDb, resetDb, seedRestaurant, seedStaff } from './test-utils.ts'
import type { JwtClaims } from './rls.ts'
import {
  atualizarPedido, contarPedidosNovos, listarEspacos, listarPedidos, membrosDaEquipe, revelarTelefonePedido, salvarEspaco,
} from './painel-eventos.ts'
import { TELEFONE_SIMULADO } from './simulador.ts'
import { auditLog, customers, eventRequests, eventSpaces, staff, units } from './schema/index.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const as = (sub: string, aal: 'aal1' | 'aal2' = 'aal2'): JwtClaims => ({ sub, role: 'authenticated', aal })
const KEY = randomBytes(32)
const TELEFONE = '5561999998888'

async function cenario() {
  const { restaurantId, unitId: u1 } = await seedRestaurant(db)
  const [u2] = await db.insert(units).values({ restaurantId, nome: 'Asa Norte', slug: 'asa-norte' }).returning()
  const dono = await seedStaff(db, sql, { restaurantId, papel: 'dono' })
  const gerenteU1 = await seedStaff(db, sql, { restaurantId, papel: 'gerente' })
  await db.update(staff).set({ unidadesPermitidas: [u1], nome: 'Gerente Um' }).where(eq(staff.userId, gerenteU1))
  const atendente = await seedStaff(db, sql, { restaurantId, papel: 'atendente' })
  const [c] = await db.insert(customers).values({ restaurantId, waIdHash: 'h1', telefoneCifrado: encryptPhone(TELEFONE, KEY) }).returning()
  return { restaurantId, u1, u2: u2!.id, dono, gerenteU1, atendente, customerId: c!.id }
}
type Cenario = Awaited<ReturnType<typeof cenario>>
const espaco = (unitId: string, o: Record<string, unknown> = {}) =>
  ({ unitId, nome: 'Salão', capacidadeMin: 10, capacidadeMax: 80, descricao: null, condicoes: null, ativo: true, ...o }) as Parameters<typeof salvarEspaco>[3]

async function novoPedido(c: Cenario, o: Partial<typeof eventRequests.$inferInsert> = {}) {
  const [p] = await db.insert(eventRequests).values({
    restaurantId: c.restaurantId, unitId: c.u1, customerId: c.customerId, data: '2026-11-20', convidados: 40, tipo: 'aniversario', nome: 'Ana', ...o,
  }).returning()
  return p!
}
const logs = (id: string) => db.select().from(auditLog).where(eq(auditLog.entidadeId, id))

describe('painel de espaços', () => {
  it('dono cria e edita; gerente só na sua unidade; atendente não grava; nome duplicado na unidade', async () => {
    const c = await cenario()
    const r = await salvarEspaco(db, as(c.dono), null, espaco(c.u2, { descricao: 'Amplo' }))
    expect(r.ok).toBe(true)
    const id = r.ok ? r.valor.id : ''
    expect(await salvarEspaco(db, as(c.dono), null, espaco(c.u2))).toEqual({ ok: false, erro: 'nome_duplicado' })
    expect((await salvarEspaco(db, as(c.dono), null, espaco(c.u1))).ok).toBe(true) // mesmo nome em outra unidade
    // unidade fora do acesso é invisível (RLS de units)
    expect(await salvarEspaco(db, as(c.gerenteU1), null, espaco(c.u2, { nome: 'Varanda' }))).toEqual({ ok: false, erro: 'nao_encontrada' })
    expect(await salvarEspaco(db, as(c.gerenteU1), id, espaco(c.u2, { nome: 'Varanda' }))).toEqual({ ok: false, erro: 'nao_encontrada' })
    expect(await salvarEspaco(db, as(c.atendente, 'aal1'), null, espaco(c.u1, { nome: 'Varanda' }))).toEqual({ ok: false, erro: 'sem_permissao' })
    expect((await salvarEspaco(db, as(c.gerenteU1), null, espaco(c.u1, { nome: 'Varanda' }))).ok).toBe(true)
    expect(await salvarEspaco(db, as(c.dono), id, espaco(c.u2, { nome: 'Salão Nobre', ativo: false, capacidadeMax: 100 }))).toEqual({ ok: true, valor: { id } })
    const [e] = await db.select().from(eventSpaces).where(eq(eventSpaces.id, id))
    expect(e).toMatchObject({ nome: 'Salão Nobre', ativo: false, capacidadeMax: 100, unitId: c.u2, restaurantId: c.restaurantId })
    expect((await logs(id)).map((l) => l.acao).sort()).toEqual(['espaco.atualizado', 'espaco.criado'])
  })

  it('listarEspacos: por unidade, inclui inativos; gerente não lista outra unidade', async () => {
    const c = await cenario()
    await salvarEspaco(db, as(c.dono), null, espaco(c.u1, { nome: 'Varanda', ativo: false }))
    await salvarEspaco(db, as(c.dono), null, espaco(c.u1))
    await salvarEspaco(db, as(c.dono), null, espaco(c.u2))
    const l = await listarEspacos(db, as(c.atendente, 'aal1'), c.u1)
    expect(l.map((e) => [e.nome, e.ativo])).toEqual([['Salão', true], ['Varanda', false]])
    expect(await listarEspacos(db, as(c.gerenteU1), c.u2)).toEqual([])
  })
})

describe('painel de pedidos de evento', () => {
  it('listarPedidos: exclui simulados, filtra status e unidade, ordena por data e criação; traz nomes', async () => {
    const c = await cenario()
    const [esp] = await db.insert(eventSpaces).values({ restaurantId: c.restaurantId, unitId: c.u1, nome: 'Salão', capacidadeMin: 1, capacidadeMax: 80 }).returning()
    const p1 = await novoPedido(c, { data: '2026-12-01' })
    const p2 = await novoPedido(c, { spaceId: esp!.id, responsavelId: c.gerenteU1, customerId: null })
    const p3 = await novoPedido(c, { unitId: c.u2 })
    await novoPedido(c, { simulado: true })
    await novoPedido(c, { status: 'recusado' })
    const r = await listarPedidos(db, as(c.dono), { status: ['novo', 'em_contato'], unitId: null })
    expect(r.map((p) => p.id)).toEqual([p2.id, p3.id, p1.id])
    expect(r[0]).toMatchObject({ unidade: 'Asa Sul', espaco: 'Salão', responsavel: 'Gerente Um', temTelefone: false, status: 'novo' })
    expect(r[2]).toMatchObject({ espaco: null, responsavel: null, temTelefone: true })
    expect((await listarPedidos(db, as(c.dono), { status: ['novo'], unitId: c.u2 })).map((p) => p.id)).toEqual([p3.id])
    expect((await listarPedidos(db, as(c.gerenteU1), { status: ['novo'], unitId: null })).map((p) => p.id)).toEqual([p2.id, p1.id])
    expect(await listarPedidos(db, as(c.dono), { status: [], unitId: null })).toEqual([])
    expect(await contarPedidosNovos(db, as(c.dono))).toBe(3)
    expect(await contarPedidosNovos(db, as(c.gerenteU1))).toBe(2)
  })

  it('atendente atualiza status, responsável e notas; audita sem o texto das notas', async () => {
    const c = await cenario()
    const p = await novoPedido(c)
    const r = await atualizarPedido(db, as(c.atendente, 'aal1'), p.id, { status: 'em_contato', responsavelId: c.atendente, notasInternas: 'Cliente pediu bolo sem glúten' })
    expect(r).toEqual({ ok: true, valor: null })
    const [linha] = await db.select().from(eventRequests).where(eq(eventRequests.id, p.id))
    expect(linha).toMatchObject({ status: 'em_contato', responsavelId: c.atendente, notasInternas: 'Cliente pediu bolo sem glúten' })
    const ls = await logs(p.id)
    expect(ls.map((l) => l.acao).sort()).toEqual(['evento.notas', 'evento.responsavel', 'evento.status'])
    expect(JSON.stringify(ls.map((l) => l.diff))).not.toContain('glúten')
    expect(ls.find((l) => l.acao === 'evento.status')!.diff).toEqual({ de: 'novo', para: 'em_contato' })
    // mesmo status ⇒ ok sem auditar
    expect(await atualizarPedido(db, as(c.atendente, 'aal1'), p.id, { status: 'em_contato' })).toEqual({ ok: true, valor: null })
    expect(await logs(p.id)).toHaveLength(3)
  })

  it('transições inválidas ⇒ transicao_invalida; finais não mudam', async () => {
    const c = await cenario()
    const p = await novoPedido(c, { status: 'confirmado' })
    expect(await atualizarPedido(db, as(c.dono), p.id, { status: 'em_contato' })).toEqual({ ok: false, erro: 'transicao_invalida' })
    expect(await atualizarPedido(db, as(c.dono), p.id, { status: 'novo' })).toEqual({ ok: false, erro: 'transicao_invalida' })
    expect(await atualizarPedido(db, as(c.dono), p.id, { status: 'cancelado' })).toEqual({ ok: true, valor: null })
    expect(await atualizarPedido(db, as(c.dono), p.id, { status: 'confirmado' })).toEqual({ ok: false, erro: 'transicao_invalida' })
    const q = await novoPedido(c, { status: 'em_contato' })
    expect(await atualizarPedido(db, as(c.dono), q.id, { status: 'novo' })).toEqual({ ok: false, erro: 'transicao_invalida' })
    expect(await atualizarPedido(db, as(c.dono), q.id, { status: 'recusado' })).toEqual({ ok: true, valor: null })
    expect(await atualizarPedido(db, as(c.dono), q.id, { status: 'cancelado' })).toEqual({ ok: false, erro: 'transicao_invalida' })
    const [linha] = await db.select().from(eventRequests).where(eq(eventRequests.id, q.id))
    expect(linha!.status).toBe('recusado')
  })

  it('atualizar: outra unidade, simulado ou inexistente ⇒ nao_encontrada; responsável de fora da equipe ⇒ nao_encontrada', async () => {
    const c = await cenario()
    const p = await novoPedido(c, { unitId: c.u2 })
    const s = await novoPedido(c, { simulado: true })
    expect(await atualizarPedido(db, as(c.gerenteU1), p.id, { status: 'em_contato' })).toEqual({ ok: false, erro: 'nao_encontrada' })
    expect(await atualizarPedido(db, as(c.dono), s.id, { status: 'em_contato' })).toEqual({ ok: false, erro: 'nao_encontrada' })
    expect(await atualizarPedido(db, as(c.dono), '00000000-0000-4000-8000-000000000000', { status: 'em_contato' })).toEqual({ ok: false, erro: 'nao_encontrada' })
    const outro = await seedRestaurant(db)
    const estranho = await seedStaff(db, sql, { restaurantId: outro.restaurantId, papel: 'atendente' })
    expect(await atualizarPedido(db, as(c.dono), p.id, { responsavelId: estranho })).toEqual({ ok: false, erro: 'nao_encontrada' })
    expect(await logs(p.id)).toHaveLength(0)
  })

  it('revelarTelefonePedido: decifra, audita sem o número; outra unidade, sem cliente ou simulado ⇒ nao_encontrada', async () => {
    const c = await cenario()
    const p = await novoPedido(c)
    expect(await revelarTelefonePedido(db, as(c.atendente, 'aal1'), p.id, KEY)).toEqual({ ok: true, valor: { telefone: TELEFONE } })
    const ls = await logs(p.id)
    expect(ls).toHaveLength(1)
    expect(ls[0]).toMatchObject({ acao: 'evento.telefone_visualizado', atorId: c.atendente, entidade: 'event_request' })
    expect(JSON.stringify(ls[0])).not.toContain(TELEFONE)
    const p2 = await novoPedido(c, { unitId: c.u2 })
    expect(await revelarTelefonePedido(db, as(c.gerenteU1), p2.id, KEY)).toEqual({ ok: false, erro: 'nao_encontrada' })
    const p3 = await novoPedido(c, { customerId: null })
    expect(await revelarTelefonePedido(db, as(c.dono), p3.id, KEY)).toEqual({ ok: false, erro: 'nao_encontrada' })
    const [sim] = await db.insert(customers).values({ restaurantId: c.restaurantId, waIdHash: 'h2', telefoneCifrado: TELEFONE_SIMULADO, simulado: true }).returning()
    const p4 = await novoPedido(c, { customerId: sim!.id })
    expect(await revelarTelefonePedido(db, as(c.dono), p4.id, KEY)).toEqual({ ok: false, erro: 'nao_encontrada' })
    const p5 = await novoPedido(c, { simulado: true })
    expect(await revelarTelefonePedido(db, as(c.dono), p5.id, KEY)).toEqual({ ok: false, erro: 'nao_encontrada' })
    const auditados = await db.select().from(auditLog).where(and(eq(auditLog.acao, 'evento.telefone_visualizado')))
    expect(auditados).toHaveLength(1)
  })

  it('membrosDaEquipe: staff ativo do restaurante, por nome', async () => {
    const c = await cenario()
    const outro = await seedRestaurant(db)
    await seedStaff(db, sql, { restaurantId: outro.restaurantId, papel: 'dono' })
    await db.update(staff).set({ ativo: false }).where(eq(staff.userId, c.dono))
    const m = await membrosDaEquipe(db, as(c.atendente, 'aal1'))
    expect(m).toEqual([{ id: c.atendente, nome: 'atendente' }, { id: c.gerenteU1, nome: 'Gerente Um' }])
  })
})
