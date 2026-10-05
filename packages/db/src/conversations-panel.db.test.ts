import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { getTestDb, resetDb, seedRestaurant, seedStaff } from './test-utils.ts'
import { listAwaitingHuman, returnToAi } from './conversations-panel.ts'
import { auditLog, conversations, customers } from './schema/index.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const claims = (sub: string, aal: 'aal1' | 'aal2' = 'aal1') => ({ sub, role: 'authenticated' as const, aal })

async function conversaAguardando(restaurantId: string, nome = 'Maria', estado: 'ia' | 'aguardando_humano' | 'humano' | 'encerrada' = 'aguardando_humano', lastMessageAt?: Date) {
  const [c] = await db.insert(customers).values({ restaurantId, waIdHash: crypto.randomUUID(), telefoneCifrado: 'x', nomePerfil: nome }).returning()
  const [conv] = await db.insert(conversations).values({ restaurantId, customerId: c!.id, estado, ...(lastMessageAt && { lastMessageAt }) }).returning()
  return conv!.id
}

describe('devolver à IA', () => {
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

  it('devolve, audita e fica com a IA', async () => {
    const { restaurantId } = await seedRestaurant(db)
    const atendente = await seedStaff(db, sql, { restaurantId, papel: 'atendente' })
    const id = await conversaAguardando(restaurantId)
    expect(await returnToAi(db, claims(atendente), id)).toBe('devolvida')
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, id))
    expect(conv!.estado).toBe('ia')
    const audit = await db.select().from(auditLog)
    expect(audit.map((x) => [x.acao, x.atorTipo, x.atorId, x.entidadeId])).toEqual([['conversa.devolvida_ia', 'staff', atendente, id]])
  })

  it('idempotente: a segunda devolução não audita de novo', async () => {
    const { restaurantId } = await seedRestaurant(db)
    const atendente = await seedStaff(db, sql, { restaurantId, papel: 'atendente' })
    const id = await conversaAguardando(restaurantId)
    const r = await Promise.all([returnToAi(db, claims(atendente), id), returnToAi(db, claims(atendente), id)])
    expect(r.sort()).toEqual(['devolvida', 'ja_estava'])
    expect(await db.select().from(auditLog)).toHaveLength(1)
  })

  it('conversa de outro restaurante não é encontrada (RLS)', async () => {
    const a = await seedRestaurant(db)
    const b = await seedRestaurant(db)
    const atendente = await seedStaff(db, sql, { restaurantId: a.restaurantId, papel: 'atendente' })
    const deB = await conversaAguardando(b.restaurantId)
    expect(await returnToAi(db, claims(atendente), deB)).toBe('nao_encontrada')
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, deB))
    expect(conv!.estado).toBe('aguardando_humano')
  })

  it('dono sem MFA não consegue devolver', async () => {
    const { restaurantId } = await seedRestaurant(db)
    const dono = await seedStaff(db, sql, { restaurantId, papel: 'dono' })
    const id = await conversaAguardando(restaurantId)
    expect(await returnToAi(db, claims(dono, 'aal1'), id)).toBe('nao_encontrada')
    expect(await returnToAi(db, claims(dono, 'aal2'), id)).toBe('devolvida')
  })
})
