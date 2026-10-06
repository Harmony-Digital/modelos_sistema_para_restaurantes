import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql as dsql } from 'drizzle-orm'
import { getTestDb, resetDb, seedRestaurant, seedStaff } from './test-utils.ts'
import { withRole, withUserContext, type JwtClaims } from './rls.ts'
import { conversations, customers, messages, quickReplies, staff, units } from './schema/index.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const as = (sub: string, aal: 'aal1' | 'aal2' = 'aal2'): JwtClaims => ({ sub, role: 'authenticated', aal })
const negado = { cause: { code: '42501' } }

async function cenario() {
  const a = await seedRestaurant(db)
  const [u2] = await db.insert(units).values({ restaurantId: a.restaurantId, nome: 'Norte', slug: 'norte' }).returning()
  const dono = await seedStaff(db, sql, { restaurantId: a.restaurantId, papel: 'dono' })
  const gerente = await seedStaff(db, sql, { restaurantId: a.restaurantId, papel: 'gerente' })
  await db.update(staff).set({ unidadesPermitidas: [a.unitId] }).where(eq(staff.userId, gerente))
  const atendente = await seedStaff(db, sql, { restaurantId: a.restaurantId, papel: 'atendente' })
  await db.update(staff).set({ unidadesPermitidas: [a.unitId] }).where(eq(staff.userId, atendente))
  const conv = async (unitId: string | null) => {
    const [c] = await db.insert(customers).values({ restaurantId: a.restaurantId, waIdHash: crypto.randomUUID(), telefoneCifrado: 'x' }).returning()
    const [cv] = await db.insert(conversations).values({ restaurantId: a.restaurantId, customerId: c!.id, unidadeContextoId: unitId }).returning()
    await db.insert(messages).values({ restaurantId: a.restaurantId, conversationId: cv!.id, direcao: 'in', autor: 'cliente', tipo: 'texto', texto: 'oi' })
    return cv!.id
  }
  const sul = await conv(a.unitId)
  const norte = await conv(u2!.id)
  const sem = await conv(null)
  return { ...a, u2: u2!.id, dono, gerente, atendente, sul, norte, sem }
}

describe('RLS da inbox: conversas e mensagens por unidade', () => {
  it('restrito vê só conversas e mensagens da sua unidade; quem acessa todas vê inclusive sem unidade', async () => {
    const c = await cenario()
    for (const quem of [as(c.gerente), as(c.atendente, 'aal1')]) {
      expect((await withUserContext(db, quem, (tx) => tx.select({ id: conversations.id }).from(conversations))).map((x) => x.id)).toEqual([c.sul])
      expect((await withUserContext(db, quem, (tx) => tx.select({ id: messages.conversationId }).from(messages))).map((x) => x.id)).toEqual([c.sul])
    }
    expect(await withUserContext(db, as(c.dono), (tx) => tx.select().from(conversations))).toHaveLength(3)
    expect(await withUserContext(db, as(c.dono), (tx) => tx.select().from(messages))).toHaveLength(3)
    expect(await withUserContext(db, as(c.dono, 'aal1'), (tx) => tx.select().from(messages))).toHaveLength(0)
  })

  it('restrito não altera conversa de outra unidade; ninguém do painel insere ou apaga mensagens', async () => {
    const c = await cenario()
    const upd = await withUserContext(db, as(c.gerente), (tx) =>
      tx.update(conversations).set({ estado: 'humano' }).where(eq(conversations.id, c.norte)).returning())
    expect(upd).toHaveLength(0)
    await expect(withUserContext(db, as(c.dono), (tx) =>
      tx.insert(messages).values({ restaurantId: c.restaurantId, conversationId: c.sul, direcao: 'out', autor: 'humano', tipo: 'texto', texto: 'x' }),
    )).rejects.toMatchObject(negado)
    await expect(withUserContext(db, as(c.dono), (tx) => tx.delete(messages))).rejects.toMatchObject(negado)
    await expect(withUserContext(db, as(c.dono), (tx) => tx.delete(conversations))).rejects.toMatchObject(negado)
    // colunas novas não são do painel direto
    await expect(withUserContext(db, as(c.dono), (tx) =>
      tx.update(conversations).set({ aguardandoDesde: null }))).rejects.toMatchObject(negado)
    await expect(withUserContext(db, as(c.dono), (tx) =>
      tx.update(conversations).set({ unidadeContextoId: c.u2 }))).rejects.toMatchObject(negado)
  })

  it('aguardando_desde: marcado ao entrar em aguardando_humano e zerado ao sair', async () => {
    const c = await cenario()
    const [x] = await db.select().from(conversations).where(eq(conversations.id, c.sul))
    expect(x!.aguardandoDesde).toBeNull()
    await withRole(db, 'worker_app', (tx) => tx.update(conversations).set({ estado: 'aguardando_humano' }).where(eq(conversations.id, c.sul)))
    const [y] = await db.select().from(conversations).where(eq(conversations.id, c.sul))
    expect(y!.aguardandoDesde).toBeInstanceOf(Date)
    // outra atualização com a conversa ainda aguardando não reinicia a espera
    await withRole(db, 'worker_app', (tx) => tx.update(conversations).set({ falhasConsecutivas: 1, estado: 'aguardando_humano' }).where(eq(conversations.id, c.sul)))
    const [y2] = await db.select().from(conversations).where(eq(conversations.id, c.sul))
    expect(y2!.aguardandoDesde!.getTime()).toBe(y!.aguardandoDesde!.getTime())
    await withRole(db, 'worker_app', (tx) => tx.update(conversations).set({ estado: 'humano' }).where(eq(conversations.id, c.sul)))
    const [z] = await db.select().from(conversations).where(eq(conversations.id, c.sul))
    expect(z!.aguardandoDesde).toBeNull()
  })

  it('índices da inbox existem', async () => {
    const r = await sql<{ indexname: string }[]>`
      select indexname from pg_indexes where tablename = 'conversations' and indexname in ('conversations_aguardando_idx', 'conversations_unidade_idx') order by 1`
    expect(r.map((x) => x.indexname)).toEqual(['conversations_aguardando_idx', 'conversations_unidade_idx'])
  })
})

describe('RLS das respostas rápidas', () => {
  it('equipe lê; gestão escreve; atendente não escreve; isolado por restaurante; sem MFA nada; sem DELETE', async () => {
    const c = await cenario()
    const b = await seedRestaurant(db)
    await db.insert(quickReplies).values({ restaurantId: b.restaurantId, titulo: 'Outro', texto: 'x' })
    // SQL explícito: authenticated só tem INSERT nas colunas do formulário (o Drizzle mandaria `default` em todas)
    const ins = (claims: JwtClaims, restaurantId = c.restaurantId, titulo = 'Um momento') => withUserContext(db, claims, (tx) =>
      tx.execute<{ id: string }>(dsql`insert into public.quick_replies (restaurant_id, titulo, texto)
        values (${restaurantId}, ${titulo}, 'Vou verificar') returning id`))
    const [q] = await ins(as(c.gerente))
    await ins(as(c.dono))
    await expect(ins(as(c.atendente, 'aal1'))).rejects.toMatchObject(negado)
    await expect(ins(as(c.dono), b.restaurantId)).rejects.toMatchObject(negado)
    await expect(ins(as(c.dono, 'aal1'))).rejects.toMatchObject(negado)
    expect(await withUserContext(db, as(c.atendente, 'aal1'), (tx) => tx.select().from(quickReplies))).toHaveLength(2)
    expect(await withUserContext(db, as(c.dono, 'aal1'), (tx) => tx.select().from(quickReplies))).toHaveLength(0)
    const upd = await withUserContext(db, as(c.atendente, 'aal1'), (tx) =>
      tx.update(quickReplies).set({ titulo: 'x' }).where(eq(quickReplies.id, q!.id)).returning())
    expect(upd).toHaveLength(0)
    await expect(withUserContext(db, as(c.dono), (tx) =>
      tx.update(quickReplies).set({ restaurantId: b.restaurantId }))).rejects.toMatchObject(negado)
    await expect(withUserContext(db, as(c.dono), (tx) => tx.delete(quickReplies))).rejects.toMatchObject(negado)
    await expect(withRole(db, 'web_app', (tx) => tx.delete(quickReplies))).rejects.toMatchObject(negado)
    // limites de tamanho no banco
    await expect(ins(as(c.dono), c.restaurantId, 'x'.repeat(41))).rejects.toMatchObject({ cause: { code: '23514' } })
  })

  it('função da métrica: execução só para authenticated', async () => {
    const r = await sql<{ ok: boolean }[]>`select has_function_privilege('anon', 'app.tempo_ate_assumir_hoje()', 'execute') as ok`
    expect(r[0]!.ok).toBe(false)
    await expect(withUserContext(db, as(crypto.randomUUID()), (tx) =>
      tx.execute(dsql`select app.tempo_ate_assumir_hoje() as t`))).resolves.toBeDefined()
  })
})
