import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { getTestDb, resetDb, seedRestaurant } from './test-utils.ts'
import {
  cancelarPedidoDoCliente, espacosAtivos, pedidosDoCliente, registrarPedidoEvento, type GravarPedido,
} from './eventos.ts'
import { customers, eventRequests, eventSpaces, units } from './schema/index.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

async function cliente(restaurantId: string, hash: string) {
  const [c] = await db.insert(customers).values({ restaurantId, waIdHash: hash, telefoneCifrado: 'x' }).returning({ id: customers.id })
  return c!.id
}
const pedido = (restaurantId: string, customerId: string, unitId: string, o: Partial<GravarPedido> = {}): GravarPedido => ({
  restaurantId, customerId, unitId, spaceId: null, data: '2026-11-20', convidados: 40, tipo: 'aniversario', tipoTexto: null,
  observacoes: null, nome: 'Ana', simulado: false, ...o,
})

describe('eventos do worker', () => {
  it('espacosAtivos: só ativos do restaurante e de unidade ativa', async () => {
    const a = await seedRestaurant(db)
    const b = await seedRestaurant(db)
    const [u2] = await db.insert(units).values({ restaurantId: a.restaurantId, nome: 'Norte', slug: 'norte', ativo: false }).returning()
    await db.insert(eventSpaces).values([
      { restaurantId: a.restaurantId, unitId: a.unitId, nome: 'Salão', capacidadeMin: 10, capacidadeMax: 80, descricao: 'Amplo', condicoes: 'Sinal de 30%' },
      { restaurantId: a.restaurantId, unitId: a.unitId, nome: 'Varanda', capacidadeMin: 5, capacidadeMax: 20, ativo: false },
      { restaurantId: a.restaurantId, unitId: u2!.id, nome: 'Terraço', capacidadeMin: 5, capacidadeMax: 20 },
      { restaurantId: b.restaurantId, unitId: b.unitId, nome: 'Outro', capacidadeMin: 5, capacidadeMax: 20 },
    ])
    const r = await espacosAtivos(db, a.restaurantId)
    expect(r).toEqual([{
      id: expect.any(String), unitId: a.unitId, nome: 'Salão', capacidadeMin: 10, capacidadeMax: 80, descricao: 'Amplo', condicoes: 'Sinal de 30%',
    }])
  })

  it('registra pedido com status novo e lista os ativos do cliente a partir da data', async () => {
    const { restaurantId, unitId } = await seedRestaurant(db)
    const c = await cliente(restaurantId, 'h1')
    const outro = await cliente(restaurantId, 'h2')
    const p1 = await db.transaction((tx) => registrarPedidoEvento(tx, pedido(restaurantId, c, unitId, { data: '2026-12-01', tipo: 'outro', tipoTexto: 'Formatura' })))
    const p2 = await db.transaction((tx) => registrarPedidoEvento(tx, pedido(restaurantId, c, unitId)))
    await db.transaction((tx) => registrarPedidoEvento(tx, pedido(restaurantId, c, unitId, { data: '2026-10-01' })))
    await db.transaction((tx) => registrarPedidoEvento(tx, pedido(restaurantId, outro, unitId)))
    const [linha] = await db.select().from(eventRequests).where(eq(eventRequests.id, p1.id))
    expect(linha).toMatchObject({ status: 'novo', simulado: false, tipoTexto: 'Formatura', nome: 'Ana', customerId: c })
    const r = await pedidosDoCliente(db, { restaurantId, customerId: c, aPartirDe: '2026-10-05' })
    expect(r).toEqual([
      { id: p2.id, unitId, data: '2026-11-20', convidados: 40, tipo: 'aniversario', status: 'novo' },
      { id: p1.id, unitId, data: '2026-12-01', convidados: 40, tipo: 'outro', status: 'novo' },
    ])
    await db.update(eventRequests).set({ status: 'recusado' }).where(eq(eventRequests.id, p2.id))
    expect((await pedidosDoCliente(db, { restaurantId, customerId: c, aPartirDe: '2026-10-05' })).map((x) => x.id)).toEqual([p1.id])
  })

  it('cancelar: só do próprio cliente e só novo/em_contato', async () => {
    const { restaurantId, unitId } = await seedRestaurant(db)
    const c1 = await cliente(restaurantId, 'h1')
    const c2 = await cliente(restaurantId, 'h2')
    const p = await db.transaction((tx) => registrarPedidoEvento(tx, pedido(restaurantId, c1, unitId)))
    expect(await db.transaction((tx) => cancelarPedidoDoCliente(tx, { restaurantId, customerId: c2, pedidoId: p.id }))).toBe(false)
    await db.update(eventRequests).set({ status: 'confirmado' }).where(eq(eventRequests.id, p.id))
    expect(await db.transaction((tx) => cancelarPedidoDoCliente(tx, { restaurantId, customerId: c1, pedidoId: p.id }))).toBe(false)
    await db.update(eventRequests).set({ status: 'em_contato' }).where(eq(eventRequests.id, p.id))
    expect(await db.transaction((tx) => cancelarPedidoDoCliente(tx, { restaurantId, customerId: c1, pedidoId: p.id }))).toBe(true)
    const [linha] = await db.select().from(eventRequests).where(eq(eventRequests.id, p.id))
    expect(linha!.status).toBe('cancelado')
    expect(await db.transaction((tx) => cancelarPedidoDoCliente(tx, { restaurantId, customerId: c1, pedidoId: p.id }))).toBe(false)
  })

  it('checks do banco: convidados 1–1000, capacidade coerente, nome de espaço único por unidade', async () => {
    const { restaurantId, unitId } = await seedRestaurant(db)
    const c = await cliente(restaurantId, 'h1')
    await expect(db.transaction((tx) => registrarPedidoEvento(tx, pedido(restaurantId, c, unitId, { convidados: 1001 })))).rejects.toMatchObject({ cause: { code: '23514' } })
    await expect(db.transaction((tx) => registrarPedidoEvento(tx, pedido(restaurantId, c, unitId, { observacoes: 'x'.repeat(301) })))).rejects.toMatchObject({ cause: { code: '23514' } })
    await expect(db.insert(eventSpaces).values({ restaurantId, unitId, nome: 'S', capacidadeMin: 30, capacidadeMax: 20 })).rejects.toMatchObject({ cause: { code: '23514' } })
    await db.insert(eventSpaces).values({ restaurantId, unitId, nome: 'S', capacidadeMin: 1, capacidadeMax: 1000 })
    await expect(db.insert(eventSpaces).values({ restaurantId, unitId, nome: 'S', capacidadeMin: 1, capacidadeMax: 10 })).rejects.toMatchObject({ cause: { code: '23505' } })
  })
})
