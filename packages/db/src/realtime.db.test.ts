import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql as dsql } from 'drizzle-orm'
import { getTestDb, resetDb, seedRestaurant, seedStaff } from './test-utils.ts'
import { withRole, withUserContext, type JwtClaims } from './rls.ts'
import { conversations, customers, messages, staff, units } from './schema/index.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const as = (sub: string, aal: 'aal1' | 'aal2' = 'aal2'): JwtClaims => ({ sub, role: 'authenticated', aal })

type Linha = { topic: string; event: string; private: boolean; extension: string; payload: Record<string, unknown> }
const doTopico = (topic: string) =>
  sql<Linha[]>`select topic, event, private, extension, payload from realtime.messages where topic = ${topic} order by inserted_at`

/**
 * Simula a checagem do Realtime: ele assume `authenticated` com os claims do JWT, define `realtime.topic`
 * e faz SELECT em realtime.messages sob RLS. Pode ouvir ⇒ a policy deixa ver linhas do tópico.
 */
async function podeOuvir(claims: JwtClaims, topic: string): Promise<boolean> {
  const rows = await withUserContext(db, claims, async (tx) => {
    await tx.execute(dsql`select set_config('realtime.topic', ${topic}, true)`)
    return tx.execute<{ n: number }>(dsql`select count(*)::int as n from realtime.messages where topic = ${topic}`)
  })
  return (rows[0]?.n ?? 0) > 0
}

async function cenario() {
  const a = await seedRestaurant(db)
  const [u2] = await db.insert(units).values({ restaurantId: a.restaurantId, nome: 'Norte', slug: 'norte' }).returning()
  const dono = await seedStaff(db, sql, { restaurantId: a.restaurantId, papel: 'dono' })
  const gerente = await seedStaff(db, sql, { restaurantId: a.restaurantId, papel: 'gerente' })
  await db.update(staff).set({ unidadesPermitidas: [a.unitId] }).where(eq(staff.userId, gerente))
  const atendente = await seedStaff(db, sql, { restaurantId: a.restaurantId, papel: 'atendente' })
  await db.update(staff).set({ unidadesPermitidas: [a.unitId] }).where(eq(staff.userId, atendente))
  const conv = async (unitId: string | null) => {
    const [c] = await db.insert(customers).values({ restaurantId: a.restaurantId, waIdHash: crypto.randomUUID(), telefoneCifrado: 'x', nomePerfil: 'Maria' }).returning()
    const [cv] = await db.insert(conversations).values({ restaurantId: a.restaurantId, customerId: c!.id, unidadeContextoId: unitId }).returning()
    return cv!.id
  }
  return { ...a, u2: u2!.id, dono, gerente, atendente, sul: await conv(a.unitId), norte: await conv(u2!.id), sem: await conv(null) }
}

describe('Realtime: broadcast por trigger, sem conteúdo', () => {
  it('mensagem nova emite em inbox:r, inbox:u e conversa:, payload só com ids', async () => {
    const c = await cenario()
    await withRole(db, 'worker_app', (tx) =>
      tx.insert(messages).values({ restaurantId: c.restaurantId, conversationId: c.sul, direcao: 'in', autor: 'cliente', tipo: 'texto', texto: 'meu CPF é 123' }))
    for (const topic of [`inbox:r:${c.restaurantId}`, `inbox:u:${c.unitId}`, `conversa:${c.sul}`]) {
      const linhas = await doTopico(topic)
      const daMsg = linhas.filter((l) => l.payload.evento === 'messages_insert')
      expect(daMsg, topic).toHaveLength(1)
      const l = daMsg[0]!
      expect(l).toMatchObject({ event: 'mudou', private: true, extension: 'broadcast' })
      expect(Object.keys(l.payload).sort()).toEqual(['conversation_id', 'evento', 'id'])
      expect(l.payload.conversation_id).toBe(c.sul)
      expect(JSON.stringify(l.payload)).not.toMatch(/CPF|Maria|123/)
    }
  })

  it('conversa sem unidade não emite em inbox:u; atualização sem mudança relevante não emite', async () => {
    const c = await cenario()
    const antes = (await doTopico(`conversa:${c.sem}`)).length
    expect(antes).toBe(1) // insert da conversa
    await db.update(conversations).set({ processedUpToId: 10, falhasConsecutivas: 1 }).where(eq(conversations.id, c.sem))
    expect(await doTopico(`conversa:${c.sem}`)).toHaveLength(1)
    await db.update(conversations).set({ estado: 'aguardando_humano' }).where(eq(conversations.id, c.sem))
    const depois = await doTopico(`conversa:${c.sem}`)
    expect(depois.map((l) => l.payload.evento)).toEqual(['conversations_insert', 'conversations_update'])
    const r = await sql<{ n: number }[]>`select count(*)::int as n from realtime.messages where payload ->> 'conversation_id' = ${c.sem} and topic like 'inbox:u:%'`
    expect(r[0]!.n).toBe(0)
  })
})

describe('Realtime: quem pode ouvir cada tópico', () => {
  it('dono ouve o tópico do restaurante e qualquer conversa; não ouve sem MFA nem outro restaurante', async () => {
    const c = await cenario()
    expect(await podeOuvir(as(c.dono), `inbox:r:${c.restaurantId}`)).toBe(true)
    expect(await podeOuvir(as(c.dono), `conversa:${c.norte}`)).toBe(true)
    expect(await podeOuvir(as(c.dono), `conversa:${c.sem}`)).toBe(true)
    expect(await podeOuvir(as(c.dono, 'aal1'), `inbox:r:${c.restaurantId}`)).toBe(false)
    const b = await seedRestaurant(db)
    const donoB = await seedStaff(db, sql, { restaurantId: b.restaurantId, papel: 'dono' })
    expect(await podeOuvir(as(donoB), `inbox:r:${c.restaurantId}`)).toBe(false)
    expect(await podeOuvir(as(donoB), `conversa:${c.sul}`)).toBe(false)
  })

  it('restritos ouvem só a sua unidade e as conversas dela', async () => {
    const c = await cenario()
    for (const quem of [as(c.gerente), as(c.atendente, 'aal1')]) {
      expect(await podeOuvir(quem, `inbox:r:${c.restaurantId}`)).toBe(false)
      expect(await podeOuvir(quem, `inbox:u:${c.unitId}`)).toBe(true)
      expect(await podeOuvir(quem, `inbox:u:${c.u2}`)).toBe(false)
      expect(await podeOuvir(quem, `conversa:${c.sul}`)).toBe(true)
      expect(await podeOuvir(quem, `conversa:${c.norte}`)).toBe(false)
      expect(await podeOuvir(quem, `conversa:${c.sem}`)).toBe(false)
    }
  })

  it('tópico malformado nega sem erro', async () => {
    const c = await cenario()
    // linhas com tópicos estranhos para a policy ter o que filtrar
    for (const t of ['inbox:u:xyz', 'conversa:abc', `conversa:${c.sul}x`, 'inbox:u:', 'qualquer']) {
      await sql`select realtime.send('{}'::jsonb, 'mudou', ${t}, true)`
      expect(await podeOuvir(as(c.dono), t), t).toBe(false)
      expect(await podeOuvir(as(c.gerente), t), t).toBe(false)
    }
  })

  it('navegador não publica: authenticated não insere em realtime.messages', async () => {
    const c = await cenario()
    await expect(withUserContext(db, as(c.dono), (tx) => tx.execute(dsql`
      insert into realtime.messages (topic, extension, payload, event, private)
      values (${`inbox:r:${c.restaurantId}`}, 'broadcast', '{}'::jsonb, 'mudou', true)`))).rejects.toMatchObject({ cause: { code: '42501' } })
  })
})
