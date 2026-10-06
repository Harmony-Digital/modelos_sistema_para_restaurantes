import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { getTestDb, resetDb, seedRestaurant, seedStaff } from './test-utils.ts'
import type { JwtClaims } from './rls.ts'
import {
  ativarArquivo, listarCardapio, registrarArquivoCardapio, salvarCategoria, salvarExcecaoItem, salvarItem,
} from './painel-cardapio.ts'
import { auditLog, menuCategories, menuFiles, menuItems, menuItemUnits, staff, units } from './schema/index.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const as = (sub: string, aal: 'aal1' | 'aal2' = 'aal2'): JwtClaims => ({ sub, role: 'authenticated', aal })

async function cenario() {
  const { restaurantId, unitId: u1 } = await seedRestaurant(db)
  const [u2] = await db.insert(units).values({ restaurantId, nome: 'Asa Norte', slug: 'asa-norte' }).returning()
  const dono = await seedStaff(db, sql, { restaurantId, papel: 'dono' })
  const gerente = await seedStaff(db, sql, { restaurantId, papel: 'gerente' })
  const gerenteU1 = await seedStaff(db, sql, { restaurantId, papel: 'gerente' })
  await db.update(staff).set({ unidadesPermitidas: [u1] }).where(eq(staff.userId, gerenteU1))
  const atendente = await seedStaff(db, sql, { restaurantId, papel: 'atendente' })
  return { restaurantId, u1, u2: u2!.id, dono, gerente, gerenteU1, atendente }
}
type Cenario = Awaited<ReturnType<typeof cenario>>

const dadosItem = (categoryId: string, o: Partial<Parameters<typeof salvarItem>[3]> = {}): Parameters<typeof salvarItem>[3] => ({
  categoryId, nome: 'Picanha', descricao: 'Com farofa', precoCentavos: 8990, tags: ['sem_gluten'], outrosNomes: ['pica'],
  disponivel: true, ordem: 1, ...o,
})
const idDe = (r: { ok: boolean; valor?: unknown }) => (r as { valor: { id: string } }).valor.id
const acoes = async (restaurantId: string) =>
  (await db.select().from(auditLog).where(eq(auditLog.restaurantId, restaurantId))).map((l) => l.acao).sort()

async function comItem(c: Cenario) {
  const cat = idDe(await salvarCategoria(db, as(c.dono), null, { nome: 'Carnes', ordem: 1, ativo: true }))
  const item = idDe(await salvarItem(db, as(c.dono), null, dadosItem(cat)))
  return { cat, item }
}

describe('categorias e itens', () => {
  it('dono cria e edita; nome duplicado (sem diferenciar caixa/acento) ⇒ nome_duplicado; audita', async () => {
    const c = await cenario()
    const r = await salvarCategoria(db, as(c.dono), null, { nome: 'Carnes', ordem: 1, ativo: true })
    expect(r.ok).toBe(true)
    const cat = idDe(r)
    expect(await salvarCategoria(db, as(c.dono), null, { nome: 'carnes', ordem: 2, ativo: true })).toEqual({ ok: false, erro: 'nome_duplicado' })
    expect(await salvarCategoria(db, as(c.dono), cat, { nome: 'Carnes nobres', ordem: 3, ativo: false })).toEqual({ ok: true, valor: { id: cat } })
    const [linha] = await db.select().from(menuCategories).where(eq(menuCategories.id, cat))
    expect(linha).toMatchObject({ nome: 'Carnes nobres', ordem: 3, ativo: false, restaurantId: c.restaurantId })

    const it1 = await salvarItem(db, as(c.dono), null, dadosItem(cat))
    expect(it1.ok).toBe(true)
    expect(await salvarItem(db, as(c.dono), null, dadosItem(cat, { nome: 'PICANHA' }))).toEqual({ ok: false, erro: 'nome_duplicado' })
    const id = idDe(it1)
    expect(await salvarItem(db, as(c.dono), id, dadosItem(cat, { precoCentavos: null, descricao: null, disponivel: false }))).toEqual({ ok: true, valor: { id } })
    const [i] = await db.select().from(menuItems).where(eq(menuItems.id, id))
    expect(i).toMatchObject({ nome: 'Picanha', precoCentavos: null, descricao: null, disponivel: false, tags: ['sem_gluten'], outrosNomes: ['pica'] })
    expect(await acoes(c.restaurantId)).toEqual(['cardapio.categoria_atualizada', 'cardapio.categoria_criada', 'cardapio.item_atualizado', 'cardapio.item_criado'])
  })

  it('gerente sem restrição grava; atendente e gerente restrito a uma unidade não gravam o cardápio geral', async () => {
    const c = await cenario()
    const { cat, item } = await comItem(c)
    expect((await salvarCategoria(db, as(c.gerente), null, { nome: 'Bebidas', ordem: 2, ativo: true })).ok).toBe(true)
    expect(await salvarCategoria(db, as(c.atendente, 'aal1'), null, { nome: 'Doces', ordem: 2, ativo: true })).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(await salvarCategoria(db, as(c.gerenteU1), null, { nome: 'Doces', ordem: 2, ativo: true })).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(await salvarItem(db, as(c.atendente, 'aal1'), item, dadosItem(cat, { precoCentavos: 1 }))).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(await salvarItem(db, as(c.gerenteU1), item, dadosItem(cat, { precoCentavos: 1 }))).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(await salvarItem(db, as(c.gerenteU1), null, dadosItem(cat, { nome: 'Cupim' }))).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(await salvarCategoria(db, as(c.dono, 'aal1'), null, { nome: 'Doces', ordem: 2, ativo: true })).toEqual({ ok: false, erro: 'sem_permissao' })
    const [i] = await db.select().from(menuItems).where(eq(menuItems.id, item))
    expect(i!.precoCentavos).toBe(8990)
  })

  it('categoria de outro restaurante ou inexistente ⇒ nao_encontrada', async () => {
    const c = await cenario()
    const b = await seedRestaurant(db)
    const [catB] = await db.insert(menuCategories).values({ restaurantId: b.restaurantId, nome: 'Carnes' }).returning()
    expect(await salvarItem(db, as(c.dono), null, dadosItem(catB!.id))).toEqual({ ok: false, erro: 'nao_encontrada' })
    expect(await salvarCategoria(db, as(c.dono), catB!.id, { nome: 'X', ordem: 1, ativo: true })).toEqual({ ok: false, erro: 'nao_encontrada' })
    const { cat } = await comItem(c)
    expect(await salvarItem(db, as(c.dono), catB!.id, dadosItem(cat))).toEqual({ ok: false, erro: 'nao_encontrada' })
  })

  it('listarCardapio: atendente lê tudo do restaurante; exceções e arquivos só das unidades visíveis', async () => {
    const c = await cenario()
    const { cat, item } = await comItem(c)
    await salvarExcecaoItem(db, as(c.dono), { itemId: item, unitId: c.u1, disponivel: false, precoOverrideCentavos: null })
    await salvarExcecaoItem(db, as(c.dono), { itemId: item, unitId: c.u2, disponivel: true, precoOverrideCentavos: 9900 })
    await registrarArquivoCardapio(db, as(c.dono), { unitId: c.u2, titulo: 'Norte', storagePath: `cardapio/${c.restaurantId}/n.pdf`, mime: 'application/pdf', tamanho: 10, sha256: 'a'.repeat(64) })
    const b = await seedRestaurant(db)
    await db.insert(menuCategories).values({ restaurantId: b.restaurantId, nome: 'Outro' })

    const l = await listarCardapio(db, as(c.atendente, 'aal1'))
    expect(l.categorias).toEqual([{ id: cat, nome: 'Carnes', ordem: 1, ativo: true }])
    expect(l.itens).toEqual([{
      id: item, categoryId: cat, nome: 'Picanha', descricao: 'Com farofa', precoCentavos: 8990, tags: ['sem_gluten'],
      outrosNomes: ['pica'], disponivel: true, ordem: 1,
    }])
    expect(l.excecoes).toEqual([
      { itemId: item, unitId: c.u1, disponivel: false, precoOverrideCentavos: null },
      { itemId: item, unitId: c.u2, disponivel: true, precoOverrideCentavos: 9900 },
    ].sort((a, b) => a.unitId.localeCompare(b.unitId)))
    expect(l.arquivos).toHaveLength(1)
    expect(l.arquivos[0]).toMatchObject({ unitId: c.u2, titulo: 'Norte', mime: 'application/pdf', tamanho: 10, ativo: true })

    const g = await listarCardapio(db, as(c.gerenteU1))
    expect(g.itens).toHaveLength(1)
    expect(g.excecoes.map((e) => e.unitId)).toEqual([c.u1])
    expect(g.arquivos).toEqual([])
  })
})

describe('exceções por unidade', () => {
  it('gerente restrito grava só na sua unidade; remover volta ao padrão sem apagar; audita', async () => {
    const c = await cenario()
    const { item } = await comItem(c)
    expect(await salvarExcecaoItem(db, as(c.gerenteU1), { itemId: item, unitId: c.u1, disponivel: true, precoOverrideCentavos: 9500 })).toEqual({ ok: true, valor: null })
    // upsert
    expect(await salvarExcecaoItem(db, as(c.gerenteU1), { itemId: item, unitId: c.u1, disponivel: false, precoOverrideCentavos: 9600 })).toEqual({ ok: true, valor: null })
    expect(await salvarExcecaoItem(db, as(c.gerenteU1), { itemId: item, unitId: c.u2, disponivel: false, precoOverrideCentavos: null })).toEqual({ ok: false, erro: 'nao_encontrada' })
    expect(await salvarExcecaoItem(db, as(c.atendente, 'aal1'), { itemId: item, unitId: c.u1, disponivel: true, precoOverrideCentavos: 1 })).toEqual({ ok: false, erro: 'sem_permissao' })
    let [e] = await db.select().from(menuItemUnits).where(eq(menuItemUnits.itemId, item))
    expect(e).toMatchObject({ unitId: c.u1, disponivel: false, precoOverrideCentavos: 9600, restaurantId: c.restaurantId })

    expect(await salvarExcecaoItem(db, as(c.gerenteU1), { itemId: item, unitId: c.u1, remover: true })).toEqual({ ok: true, valor: null })
    ;[e] = await db.select().from(menuItemUnits).where(eq(menuItemUnits.itemId, item))
    expect(e).toMatchObject({ disponivel: null, precoOverrideCentavos: null })
    expect((await listarCardapio(db, as(c.gerenteU1))).excecoes).toEqual([])
    // remover sem exceção gravada não falha
    expect(await salvarExcecaoItem(db, as(c.dono), { itemId: item, unitId: c.u2, remover: true })).toEqual({ ok: true, valor: null })
    expect(await salvarExcecaoItem(db, as(c.dono), { itemId: crypto.randomUUID(), unitId: c.u2, disponivel: true, precoOverrideCentavos: null })).toEqual({ ok: false, erro: 'nao_encontrada' })
    expect((await acoes(c.restaurantId)).filter((a) => a.startsWith('cardapio.excecao'))).toEqual([
      'cardapio.excecao_removida', 'cardapio.excecao_salva', 'cardapio.excecao_salva',
    ])
  })
})

describe('arquivos de cardápio (painel)', () => {
  const arq = (restaurantId: string, o: Partial<Parameters<typeof registrarArquivoCardapio>[2]> = {}): Parameters<typeof registrarArquivoCardapio>[2] => ({
    unitId: null, titulo: 'Cardápio', storagePath: `cardapio/${restaurantId}/x.pdf`, mime: 'application/pdf', tamanho: 1234, sha256: 'f'.repeat(64), ...o,
  })

  it('registra; mesmo sha256 no mesmo escopo devolve o existente; outra unidade cria outro', async () => {
    const c = await cenario()
    const r = await registrarArquivoCardapio(db, as(c.dono), arq(c.restaurantId))
    expect(r.ok).toBe(true)
    const id = idDe(r)
    expect(await registrarArquivoCardapio(db, as(c.dono), arq(c.restaurantId, { titulo: 'Outro título', storagePath: `cardapio/${c.restaurantId}/y.pdf` }))).toEqual({ ok: true, valor: { id } })
    const u1 = await registrarArquivoCardapio(db, as(c.gerenteU1), arq(c.restaurantId, { unitId: c.u1 }))
    expect(u1.ok && idDe(u1) !== id).toBe(true)
    expect(await db.select().from(menuFiles)).toHaveLength(2)
    expect((await acoes(c.restaurantId)).filter((a) => a.startsWith('cardapio.arquivo'))).toEqual(['cardapio.arquivo_registrado', 'cardapio.arquivo_registrado'])
  })

  it('clique duplo (simultâneo) devolve o mesmo arquivo; reenviar um desativado o reativa', async () => {
    const c = await cenario()
    const rs = await Promise.all([
      registrarArquivoCardapio(db, as(c.dono), arq(c.restaurantId)),
      registrarArquivoCardapio(db, as(c.dono), arq(c.restaurantId)),
    ])
    expect(rs.every((r) => r.ok)).toBe(true)
    const id = idDe(rs[0]!)
    expect(idDe(rs[1]!)).toBe(id)
    expect(await db.select().from(menuFiles)).toHaveLength(1)
    await ativarArquivo(db, as(c.dono), id, false)
    expect(await registrarArquivoCardapio(db, as(c.dono), arq(c.restaurantId))).toEqual({ ok: true, valor: { id } })
    expect((await db.select().from(menuFiles))[0]!.ativo).toBe(true)
    expect((await acoes(c.restaurantId)).filter((a) => a === 'cardapio.arquivo_ativo')).toHaveLength(2)
  })

  it('permissões: atendente não registra; gerente restrito não registra o geral nem de outra unidade; caminho de outro restaurante recusado', async () => {
    const c = await cenario()
    expect(await registrarArquivoCardapio(db, as(c.atendente, 'aal1'), arq(c.restaurantId))).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(await registrarArquivoCardapio(db, as(c.gerenteU1), arq(c.restaurantId))).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(await registrarArquivoCardapio(db, as(c.gerenteU1), arq(c.restaurantId, { unitId: c.u2 }))).toEqual({ ok: false, erro: 'sem_permissao' })
    const b = await seedRestaurant(db)
    expect(await registrarArquivoCardapio(db, as(c.dono), arq(c.restaurantId, { storagePath: `cardapio/${b.restaurantId}/x.pdf` }))).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(await registrarArquivoCardapio(db, as(c.dono), arq(c.restaurantId, { storagePath: `outro/${c.restaurantId}/x.pdf` }))).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(await db.select().from(menuFiles)).toEqual([])
  })

  it('ativar/desativar: dono e gerente da unidade; atendente não; inexistente ⇒ nao_encontrada', async () => {
    const c = await cenario()
    const id = idDe(await registrarArquivoCardapio(db, as(c.dono), arq(c.restaurantId, { unitId: c.u1 })))
    expect(await ativarArquivo(db, as(c.gerenteU1), id, false)).toEqual({ ok: true, valor: null })
    expect((await db.select().from(menuFiles))[0]!.ativo).toBe(false)
    expect(await ativarArquivo(db, as(c.atendente, 'aal1'), id, true)).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(await ativarArquivo(db, as(c.dono), crypto.randomUUID(), true)).toEqual({ ok: false, erro: 'nao_encontrada' })
    expect(await ativarArquivo(db, as(c.dono), id, true)).toEqual({ ok: true, valor: null })
    expect((await db.select().from(menuFiles))[0]!.ativo).toBe(true)
    expect((await acoes(c.restaurantId)).filter((a) => a === 'cardapio.arquivo_ativo')).toHaveLength(2)
  })
})
