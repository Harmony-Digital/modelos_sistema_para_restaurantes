import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'
import { baseTestUrl, comBanco, getTestDb, resetDb, seedRestaurant, seedStaff, testDbName } from './test-utils.ts'
import * as schema from './schema/index.ts'
import type { JwtClaims } from './rls.ts'
import { buscarNoPainel, MAX_RESULTADOS_BUSCA } from './painel-busca.ts'
import { conversations, customers, knowledgeFacts, menuCategories, menuItems, restaurants, staff, units } from './schema/index.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const as = (sub: string, aal: 'aal1' | 'aal2' = 'aal2'): JwtClaims => ({ sub, role: 'authenticated', aal })

async function conversa(restaurantId: string, nome: string, unitId: string | null, extra: Partial<typeof conversations.$inferInsert> = {}) {
  const simulada = extra.simulada ?? false
  const [c] = await db.insert(customers).values({ restaurantId, waIdHash: crypto.randomUUID(), telefoneCifrado: 'x', nomePerfil: nome, simulado: simulada }).returning()
  const [conv] = await db.insert(conversations).values({ restaurantId, customerId: c!.id, unidadeContextoId: unitId, ...extra, simulada }).returning()
  return conv!.id
}

async function cenario() {
  const { restaurantId, unitId: sul } = await seedRestaurant(db)
  const [norte] = await db.insert(units).values({ restaurantId, nome: 'Asa Norte', slug: 'asa-norte' }).returning()
  const dono = await seedStaff(db, sql, { restaurantId, papel: 'dono' })
  const gerenteSul = await seedStaff(db, sql, { restaurantId, papel: 'gerente' })
  await db.update(staff).set({ unidadesPermitidas: [sul] }).where(eq(staff.userId, gerenteSul))
  const atendente = await seedStaff(db, sql, { restaurantId, papel: 'atendente' })
  const [cat] = await db.insert(menuCategories).values({ restaurantId, nome: 'Pratos' }).returning()
  const [picanha] = await db.insert(menuItems).values({ restaurantId, categoryId: cat!.id, nome: 'Picanha na chapa', precoCentavos: 8900 }).returning()
  const [fGeral, fSul, fNorte] = await db.insert(knowledgeFacts).values([
    { restaurantId, tema: 'Estacionamento', texto: 'Temos estacionamento conveniado.' },
    { restaurantId, unitId: sul, tema: 'Estacionamento da Sul', texto: 'Vagas na rua.' },
    { restaurantId, unitId: norte!.id, tema: 'Estacionamento da Norte', texto: 'Valet na porta.' },
  ]).returning()
  const cSul = await conversa(restaurantId, 'Maria Asa', sul)
  const cNorte = await conversa(restaurantId, 'Mariana Norte', norte!.id)
  return { restaurantId, sul, norte: norte!.id, dono, gerenteSul, atendente, picanha: picanha!.id, fGeral: fGeral!.id, fSul: fSul!.id, fNorte: fNorte!.id, cSul, cNorte }
}

const ids = (r: { tipo: string; id: string }[], tipo: string) => r.filter((x) => x.tipo === tipo).map((x) => x.id).sort()

describe('buscarNoPainel', () => {
  it('acha unidades, itens do cardápio, informações e conversas pelo nome de perfil, sem acento nem caixa', async () => {
    const c = await cenario()
    const r = await buscarNoPainel(db, as(c.dono), 'ASA')
    expect(ids(r, 'unidade')).toEqual([c.sul, c.norte].sort())
    expect(ids(r, 'conversa')).toEqual([c.cSul])
    const prato = await buscarNoPainel(db, as(c.dono), 'picanha')
    expect(prato).toEqual([{ tipo: 'item', id: c.picanha, titulo: 'Picanha na chapa', detalhe: 'Pratos', simulada: false }])
    // prefixo de palavra (busca enquanto digita) e sem acento
    expect(ids(await buscarNoPainel(db, as(c.dono), 'pican'), 'item')).toEqual([c.picanha])
    expect(ids(await buscarNoPainel(db, as(c.dono), 'estacionamênto'), 'informacao')).toEqual([c.fGeral, c.fSul, c.fNorte].sort())
    const maria = await buscarNoPainel(db, as(c.dono), 'mari')
    expect(maria.filter((x) => x.tipo === 'conversa').map((x) => [x.titulo, x.detalhe])).toEqual(
      expect.arrayContaining([['Maria Asa', 'Asa Sul'], ['Mariana Norte', 'Asa Norte']]),
    )
  })

  it('gerente restrito não vê nada de outra unidade (unidade, informação nem conversa)', async () => {
    const c = await cenario()
    for (const termo of ['asa', 'norte', 'estacionamento', 'mari', 'valet']) {
      const r = await buscarNoPainel(db, as(c.gerenteSul), termo)
      const tudo = r.map((x) => x.id)
      expect(tudo).not.toContain(c.norte)
      expect(tudo).not.toContain(c.fNorte)
      expect(tudo).not.toContain(c.cNorte)
      expect(r.map((x) => `${x.titulo} ${x.detalhe ?? ''}`).join(' ')).not.toMatch(/Norte|Valet/)
    }
    expect(ids(await buscarNoPainel(db, as(c.gerenteSul), 'asa'), 'unidade')).toEqual([c.sul])
    expect(ids(await buscarNoPainel(db, as(c.gerenteSul), 'mari'), 'conversa')).toEqual([c.cSul])
  })

  it('usuário de outro restaurante não acha nada; atendente acha o que vê', async () => {
    const c = await cenario()
    const outro = await seedRestaurant(db)
    const donoOutro = await seedStaff(db, sql, { restaurantId: outro.restaurantId, papel: 'dono' })
    expect(await buscarNoPainel(db, as(donoOutro), 'picanha')).toEqual([])
    expect(await buscarNoPainel(db, as(donoOutro), 'mari')).toEqual([])
    expect(ids(await buscarNoPainel(db, as(c.atendente, 'aal1'), 'picanha'), 'item')).toEqual([c.picanha])
  })

  it('conversa simulada só aparece no modo demonstração; encerrada há mais de 30 dias não aparece', async () => {
    const c = await cenario()
    const sim = await conversa(c.restaurantId, 'Mário Simulado', c.sul, { simulada: true })
    await conversa(c.restaurantId, 'Marina Antiga', c.sul, { estado: 'encerrada', lastMessageAt: new Date(Date.now() - 40 * 86_400_000) })
    const recente = await conversa(c.restaurantId, 'Marta Recente', c.sul, { estado: 'encerrada', lastMessageAt: new Date(Date.now() - 2 * 86_400_000) })
    expect(ids(await buscarNoPainel(db, as(c.dono), 'mar'), 'conversa')).toEqual([c.cSul, c.cNorte, recente].sort())
    await db.update(restaurants).set({ modoDemonstracao: true }).where(eq(restaurants.id, c.restaurantId))
    const r = await buscarNoPainel(db, as(c.dono), 'mar')
    expect(ids(r, 'conversa')).toEqual([c.cSul, c.cNorte, recente, sim].sort())
    expect(r.find((x) => x.id === sim)?.simulada).toBe(true)
  })

  it('termo curto, vazio ou só curinga não consulta; curinga do LIKE é literal; no máximo 20 resultados', async () => {
    const c = await cenario()
    expect(await buscarNoPainel(db, as(c.dono), ' a ')).toEqual([])
    expect(await buscarNoPainel(db, as(c.dono), '%%')).toEqual([])
    expect(await buscarNoPainel(db, as(c.dono), '__')).toEqual([])
    expect(await buscarNoPainel(db, as(c.dono), "a%' or 1=1 --")).toEqual([])
    const [cat] = await db.select().from(menuCategories).limit(1)
    await db.insert(menuItems).values(Array.from({ length: 30 }, (_, i) => ({ restaurantId: c.restaurantId, categoryId: cat!.id, nome: `Pizza ${i}` })))
    for (let i = 0; i < 10; i++) await conversa(c.restaurantId, `Pizzaiolo ${i}`, c.sul)
    const r = await buscarNoPainel(db, as(c.dono), 'pizza')
    expect(r.length).toBeLessThanOrEqual(MAX_RESULTADOS_BUSCA)
    expect(MAX_RESULTADOS_BUSCA).toBe(20)
  })

  it('palavra que é só stopword ("de", "com") não gera NOTICE do Postgres no log a cada tecla', async () => {
    const c = await cenario()
    const avisos = vi.fn()
    const cliente = postgres(comBanco(baseTestUrl(), testDbName()), { max: 1, onnotice: avisos })
    try {
      const comAviso = drizzle({ client: cliente, schema })
      await buscarNoPainel(comAviso, as(c.dono), 'picanha de')
      await buscarNoPainel(comAviso, as(c.dono), 'com')
      expect(avisos).not.toHaveBeenCalled()
    } finally {
      await cliente.end()
    }
  })
})
