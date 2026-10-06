import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getTestDb, resetDb, seedRestaurant, seedStaff } from './test-utils.ts'
import { listAwaitingHuman } from './conversations-panel.ts'
import { conversations, customers } from './schema/index.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const claims = (sub: string, aal: 'aal1' | 'aal2' = 'aal1') => ({ sub, role: 'authenticated' as const, aal })

async function conversaAguardando(restaurantId: string, nome = 'Maria', estado: 'ia' | 'aguardando_humano' | 'humano' | 'encerrada' = 'aguardando_humano', lastMessageAt?: Date) {
  const [c] = await db.insert(customers).values({ restaurantId, waIdHash: crypto.randomUUID(), telefoneCifrado: 'x', nomePerfil: nome }).returning()
  const [conv] = await db.insert(conversations).values({ restaurantId, customerId: c!.id, estado, ...(lastMessageAt && { lastMessageAt }) }).returning()
  return conv!.id
}

describe('fila da Início (aguardando atendente)', () => {
  it('lista as conversas aguardando atendente do próprio restaurante', async () => {
    const a = await seedRestaurant(db)
    const b = await seedRestaurant(db)
    const atendente = await seedStaff(db, sql, { restaurantId: a.restaurantId, papel: 'atendente' })
    await conversaAguardando(a.restaurantId, 'Maria')
    await conversaAguardando(b.restaurantId, 'Outro restaurante')
    const itens = await listAwaitingHuman(db, claims(atendente))
    expect(itens.map((i) => i.nome)).toEqual(['Maria'])
  })

  it('lista só aguardando/humano, mais antigas primeiro', async () => {
    const { restaurantId } = await seedRestaurant(db)
    const atendente = await seedStaff(db, sql, { restaurantId, papel: 'atendente' })
    const t = (m: number) => new Date(Date.now() - m * 60_000)
    await conversaAguardando(restaurantId, 'Nova', 'aguardando_humano', t(1))
    await conversaAguardando(restaurantId, 'Antiga', 'humano', t(30))
    await conversaAguardando(restaurantId, 'Com IA', 'ia', t(40))
    await conversaAguardando(restaurantId, 'Encerrada', 'encerrada', t(50))
    const itens = await listAwaitingHuman(db, claims(atendente))
    expect(itens.map((i) => [i.nome, i.estado])).toEqual([['Antiga', 'humano'], ['Nova', 'aguardando_humano']])
  })

  it('conversa simulada pedindo atendente não aparece na fila', async () => {
    const { restaurantId } = await seedRestaurant(db)
    const atendente = await seedStaff(db, sql, { restaurantId, papel: 'atendente' })
    const [c] = await db.insert(customers).values({ restaurantId, waIdHash: 'sim:x:1', telefoneCifrado: 'simulado', simulado: true }).returning()
    await db.insert(conversations).values({ restaurantId, customerId: c!.id, estado: 'aguardando_humano', simulada: true })
    expect(await listAwaitingHuman(db, claims(atendente))).toEqual([])
  })
})
