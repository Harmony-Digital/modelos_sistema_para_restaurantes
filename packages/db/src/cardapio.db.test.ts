import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { getTestDb, resetDb, seedRestaurant } from './test-utils.ts'
import { withRole } from './rls.ts'
import { arquivoAtivoPorId, arquivoParaEnvio, buscarCardapio, guardarMidiaMeta, limparMidiaMeta, resumoCardapio } from './cardapio.ts'
import { menuCategories, menuFiles, menuItems, menuItemUnits, units } from './schema/index.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

async function cenario() {
  const { restaurantId, unitId: u1 } = await seedRestaurant(db)
  const [u2] = await db.insert(units).values({ restaurantId, nome: 'Asa Norte', slug: 'asa-norte', ordem: 1 }).returning()
  const [carnes, bebidas, saladas, sobremesas] = await db.insert(menuCategories).values([
    { restaurantId, nome: 'Carnes', ordem: 1 },
    { restaurantId, nome: 'Bebidas', ordem: 3 },
    { restaurantId, nome: 'Saladas', ordem: 2 },
    { restaurantId, nome: 'Sobremesas', ordem: 4, ativo: false },
  ]).returning()
  const item = (categoryId: string, nome: string, o: Partial<typeof menuItems.$inferInsert> = {}) =>
    ({ restaurantId, categoryId, nome, ...o }) as typeof menuItems.$inferInsert
  const its = await db.insert(menuItems).values([
    item(carnes!.id, 'Picanha na chapa', { descricao: 'Com farofa e vinagrete', precoCentavos: 8990, ordem: 1 }),
    item(carnes!.id, 'Carne-de-sol', { descricao: 'Com mandioca', precoCentavos: 5990, ordem: 2 }),
    item(carnes!.id, 'Costela', { precoCentavos: 7990, disponivel: false, ordem: 3 }),
    item(carnes!.id, 'Cupim', { precoCentavos: 6990, disponivel: false, ordem: 4 }),
    item(carnes!.id, 'Fraldinha', { precoCentavos: 6490, ordem: 5 }),
    item(bebidas!.id, 'Refrigerante lata', { precoCentavos: 700, tags: ['bebida'], outrosNomes: ['refri', 'coca'] }),
    item(saladas!.id, 'Salada verde', { precoCentavos: 3000, tags: ['vegano', 'vegetariano'] }),
    item(saladas!.id, 'Salada caprese', { precoCentavos: null, tags: ['vegetariano'] }),
    item(sobremesas!.id, 'Pudim', { precoCentavos: 1500, tags: ['sobremesa'] }),
  ]).returning()
  const id = (nome: string) => its.find((i) => i.nome === nome)!.id
  await db.insert(menuItemUnits).values([
    { restaurantId, itemId: id('Picanha na chapa'), unitId: u2!.id, precoOverrideCentavos: 9500 },
    { restaurantId, itemId: id('Carne-de-sol'), unitId: u2!.id, disponivel: false },
    { restaurantId, itemId: id('Costela'), unitId: u2!.id, disponivel: true },
  ])
  return { restaurantId, u1, u2: u2!.id, id, categorias: { carnes: carnes!.id, bebidas: bebidas!.id } }
}

const nomes = (r: { nome: string }[]) => r.map((i) => i.nome)

describe('buscarCardapio', () => {
  it('acento e hífen: "carne de sol" ⇔ "Carne-de-sol"; traz preço e disponibilidade por unidade', async () => {
    const c = await cenario()
    for (const consulta of ['carne de sol', 'carne-de-sol', 'Carne de Sól', 'CARNE DE SOL?']) {
      const r = await buscarCardapio(db, { restaurantId: c.restaurantId, consulta, tag: null })
      expect(nomes(r)[0], consulta).toBe('Carne-de-sol')
    }
    const [r] = await buscarCardapio(db, { restaurantId: c.restaurantId, consulta: 'carne de sol', tag: null })
    expect(r).toMatchObject({ categoria: 'Carnes', descricao: 'Com mandioca', precoBaseCentavos: 5990, tags: [] })
    expect(r!.rank).toBeGreaterThan(0)
    expect(r!.porUnidade).toEqual([
      { unitId: c.u1, disponivel: true, precoCentavos: 5990 },
      { unitId: c.u2, disponivel: false, precoCentavos: 5990 },
    ])
  })

  it('erro de digitação "pikanha" acha a picanha, com o preço próprio da unidade', async () => {
    const c = await cenario()
    const r = await buscarCardapio(db, { restaurantId: c.restaurantId, consulta: 'pikanha', tag: null })
    expect(nomes(r)[0]).toBe('Picanha na chapa')
    expect(r[0]!.porUnidade).toEqual([
      { unitId: c.u1, disponivel: true, precoCentavos: 8990 },
      { unitId: c.u2, disponivel: true, precoCentavos: 9500 },
    ])
  })

  it('"refri" acha pelos outros nomes; descrição também é buscável', async () => {
    const c = await cenario()
    expect(nomes(await buscarCardapio(db, { restaurantId: c.restaurantId, consulta: 'refri', tag: null }))).toEqual(['Refrigerante lata'])
    expect(nomes(await buscarCardapio(db, { restaurantId: c.restaurantId, consulta: 'farofa', tag: null }))).toEqual(['Picanha na chapa'])
  })

  it('filtro por tag (sem consulta) e tag + consulta; categoria inativa fica fora', async () => {
    const c = await cenario()
    expect(nomes(await buscarCardapio(db, { restaurantId: c.restaurantId, consulta: null, tag: 'vegetariano' }))).toEqual(['Salada caprese', 'Salada verde'])
    expect(nomes(await buscarCardapio(db, { restaurantId: c.restaurantId, consulta: null, tag: 'vegano' }))).toEqual(['Salada verde'])
    expect(nomes(await buscarCardapio(db, { restaurantId: c.restaurantId, consulta: 'salada', tag: 'vegano' }))).toEqual(['Salada verde'])
    expect(await buscarCardapio(db, { restaurantId: c.restaurantId, consulta: null, tag: 'sobremesa' })).toEqual([])
    expect(await buscarCardapio(db, { restaurantId: c.restaurantId, consulta: 'pudim', tag: null })).toEqual([])
  })

  it('indisponível no base sem unidade disponível fica fora; disponível em alguma unidade entra', async () => {
    const c = await cenario()
    expect(await buscarCardapio(db, { restaurantId: c.restaurantId, consulta: 'cupim', tag: null })).toEqual([])
    // exceção "voltou ao padrão" (tudo nulo) segue o item: continua fora
    await db.insert(menuItemUnits).values({ restaurantId: c.restaurantId, itemId: c.id('Cupim'), unitId: c.u2, disponivel: null })
    expect(await buscarCardapio(db, { restaurantId: c.restaurantId, consulta: 'cupim', tag: null })).toEqual([])
    const [costela] = await buscarCardapio(db, { restaurantId: c.restaurantId, consulta: 'costela', tag: null })
    expect(costela!.porUnidade).toEqual([
      { unitId: c.u1, disponivel: false, precoCentavos: 7990 },
      { unitId: c.u2, disponivel: true, precoCentavos: 7990 },
    ])
  })

  it('unidade inativa não aparece em porUnidade; preço null = sob consulta', async () => {
    const c = await cenario()
    await db.update(units).set({ ativo: false }).where(eq(units.id, c.u2))
    const [p] = await buscarCardapio(db, { restaurantId: c.restaurantId, consulta: 'picanha', tag: null })
    expect(p!.porUnidade).toEqual([{ unitId: c.u1, disponivel: true, precoCentavos: 8990 }])
    // costela só estava disponível na unidade inativa
    expect(await buscarCardapio(db, { restaurantId: c.restaurantId, consulta: 'costela', tag: null })).toEqual([])
    const [cap] = await buscarCardapio(db, { restaurantId: c.restaurantId, consulta: 'caprese', tag: null })
    expect(cap).toMatchObject({ precoBaseCentavos: null, porUnidade: [{ unitId: c.u1, disponivel: true, precoCentavos: null }] })
  })

  it('no máximo 8 resultados (mesmo pedindo mais)', async () => {
    const c = await cenario()
    await db.insert(menuItems).values(Array.from({ length: 12 }, (_, i) => ({
      restaurantId: c.restaurantId, categoryId: c.categorias.carnes, nome: `Pizza ${i + 1}`, precoCentavos: 4000 + i,
    })))
    expect(await buscarCardapio(db, { restaurantId: c.restaurantId, consulta: 'pizza', tag: null })).toHaveLength(8)
    expect(await buscarCardapio(db, { restaurantId: c.restaurantId, consulta: 'pizza', tag: null, limite: 50 })).toHaveLength(8)
    expect(await buscarCardapio(db, { restaurantId: c.restaurantId, consulta: 'pizza', tag: null, limite: 3 })).toHaveLength(3)
    expect(await buscarCardapio(db, { restaurantId: c.restaurantId, consulta: null, tag: null })).toHaveLength(8)
  })

  it('isola por restaurante; consulta hostil é só texto; roda como worker_app', async () => {
    const c = await cenario()
    const b = await seedRestaurant(db)
    expect(await buscarCardapio(db, { restaurantId: b.restaurantId, consulta: 'picanha', tag: null })).toEqual([])
    expect(await buscarCardapio(db, { restaurantId: c.restaurantId, consulta: "'); drop table menu_items; --", tag: null })).toEqual([])
    expect(await buscarCardapio(db, { restaurantId: c.restaurantId, consulta: '   ', tag: null })).toHaveLength(7)
    const r = await withRole(db, 'worker_app', (tx) => buscarCardapio(tx, { restaurantId: c.restaurantId, consulta: 'pikanha', tag: null }))
    expect(nomes(r)[0]).toBe('Picanha na chapa')
  })
})

describe('buscarCardapio: correspondência × parecido (I1)', () => {
  async function parecidos() {
    const { restaurantId } = await seedRestaurant(db)
    const [cat] = await db.insert(menuCategories).values({ restaurantId, nome: 'Pratos', ordem: 1 }).returning()
    await db.insert(menuItems).values(['Carne de porco', 'Suco de uva', 'File a parmegiana', 'Picanha', 'Cocada'].map((nome, i) =>
      ({ restaurantId, categoryId: cat!.id, nome, precoCentavos: 1000 + i, ordem: i })))
    return restaurantId
  }
  const busca = (restaurantId: string, consulta: string) => buscarCardapio(db, { restaurantId, consulta, tag: null })

  it('nome só parecido nunca vem como correspondência: carne de sol × carne de porco, suco de laranja × suco de uva', async () => {
    const r = await parecidos()
    for (const [consulta, outro] of [['carne de sol', 'Carne de porco'], ['suco de laranja', 'Suco de uva'], ['frango a parmegiana', 'File a parmegiana']]) {
      const achados = await busca(r, consulta!)
      expect(achados.filter((i) => !i.parecido), consulta).toEqual([])
      // continua como sugestão (parecido), para o core oferecer
      expect(achados.find((i) => i.nome === outro)?.parecido, consulta).toBe(true)
    }
  })

  it('erro de digitação e palavra do nome continuam correspondência', async () => {
    const r = await parecidos()
    for (const consulta of ['picanah', 'pikanha', 'picanha', 'carne de porco', 'porco', 'Suco de Uva']) {
      const [i] = await busca(r, consulta)
      expect(i?.parecido, consulta).toBe(false)
    }
    // sem consulta (filtro por tag) nada é "parecido"
    expect((await buscarCardapio(db, { restaurantId: r, consulta: null, tag: null })).every((i) => !i.parecido)).toBe(true)
  })
})

describe('arquivos de cardápio (worker)', () => {
  async function arquivos() {
    const c = await cenario()
    const base = { restaurantId: c.restaurantId, mime: 'application/pdf', tamanho: 1000 }
    const [geral, daU1, inativo] = await db.insert(menuFiles).values([
      { ...base, unitId: null, titulo: 'Cardápio', storagePath: `cardapio/${c.restaurantId}/geral.pdf`, sha256: 'a'.repeat(64) },
      { ...base, unitId: c.u1, titulo: 'Cardápio Asa Sul', storagePath: `cardapio/${c.restaurantId}/u1.pdf`, sha256: 'b'.repeat(64) },
      { ...base, unitId: c.u2, titulo: 'Velho', storagePath: `cardapio/${c.restaurantId}/u2.pdf`, sha256: 'c'.repeat(64), ativo: false },
    ]).returning()
    return { ...c, geral: geral!, daU1: daU1!, inativo: inativo! }
  }

  it('da unidade, senão o geral; inativo é ignorado; sem arquivo ⇒ null', async () => {
    const c = await arquivos()
    expect(await arquivoParaEnvio(db, { restaurantId: c.restaurantId, unitId: c.u1 })).toEqual({
      id: c.daU1.id, unitId: c.u1, titulo: 'Cardápio Asa Sul', storagePath: `cardapio/${c.restaurantId}/u1.pdf`,
      mime: 'application/pdf', tamanho: expect.any(Number), sha256: expect.stringMatching(/^[0-9a-f]{64}$/), waMediaId: null, waMediaExpiresAt: null,
    })
    expect((await arquivoParaEnvio(db, { restaurantId: c.restaurantId, unitId: c.u2 }))?.id).toBe(c.geral.id)
    expect((await arquivoParaEnvio(db, { restaurantId: c.restaurantId, unitId: null }))?.id).toBe(c.geral.id)
    await db.update(menuFiles).set({ ativo: false }).where(eq(menuFiles.id, c.geral.id))
    expect(await arquivoParaEnvio(db, { restaurantId: c.restaurantId, unitId: c.u2 })).toBeNull()
    const b = await seedRestaurant(db)
    expect(await arquivoParaEnvio(db, { restaurantId: b.restaurantId, unitId: null })).toBeNull()
  })

  it('guarda o media id da Meta (worker_app) e devolve no próximo envio', async () => {
    const c = await arquivos()
    const expira = new Date('2026-11-04T12:00:00Z')
    await withRole(db, 'worker_app', (tx) => guardarMidiaMeta(tx, { arquivoId: c.daU1.id, waMediaId: 'MEDIA123', expiraEm: expira }))
    const a = await withRole(db, 'worker_app', (tx) => arquivoParaEnvio(tx, { restaurantId: c.restaurantId, unitId: c.u1 }))
    expect(a).toMatchObject({ waMediaId: 'MEDIA123', waMediaExpiresAt: expira })
    await withRole(db, 'worker_app', (tx) => limparMidiaMeta(tx, c.daU1.id))
    expect(await arquivoAtivoPorId(db, { restaurantId: c.restaurantId, arquivoId: c.daU1.id }))
      .toMatchObject({ id: c.daU1.id, waMediaId: null, waMediaExpiresAt: null })
  })

  it('arquivoAtivoPorId: só ativo e do próprio restaurante', async () => {
    const c = await arquivos()
    const a = await withRole(db, 'worker_app', (tx) => arquivoAtivoPorId(tx, { restaurantId: c.restaurantId, arquivoId: c.geral.id }))
    expect(a).toMatchObject({ id: c.geral.id, unitId: null, mime: 'application/pdf' })
    const b = await seedRestaurant(db)
    expect(await arquivoAtivoPorId(db, { restaurantId: b.restaurantId, arquivoId: c.geral.id })).toBeNull()
    await db.update(menuFiles).set({ ativo: false }).where(eq(menuFiles.id, c.geral.id))
    expect(await arquivoAtivoPorId(db, { restaurantId: c.restaurantId, arquivoId: c.geral.id })).toBeNull()
  })
})

describe('resumoCardapio', () => {
  it('categorias ativas em ordem, até 3 itens disponíveis cada, preço base', async () => {
    const c = await cenario()
    expect(await resumoCardapio(db, c.restaurantId, null)).toEqual([
      { categoria: 'Carnes', itens: [{ nome: 'Picanha na chapa', precoCentavos: 8990 }, { nome: 'Carne-de-sol', precoCentavos: 5990 }, { nome: 'Fraldinha', precoCentavos: 6490 }] },
      { categoria: 'Saladas', itens: [{ nome: 'Salada caprese', precoCentavos: null }, { nome: 'Salada verde', precoCentavos: 3000 }] },
      { categoria: 'Bebidas', itens: [{ nome: 'Refrigerante lata', precoCentavos: 700 }] },
    ])
    const b = await seedRestaurant(db)
    expect(await withRole(db, 'worker_app', (tx) => resumoCardapio(tx, b.restaurantId, null))).toEqual([])
  })

  it('com unidade: preço e disponibilidade efetivos (exceção da unidade sobre o padrão)', async () => {
    const c = await cenario()
    // Asa Norte: picanha com preço próprio, carne-de-sol indisponível, costela só disponível aqui
    expect((await withRole(db, 'worker_app', (tx) => resumoCardapio(tx, c.restaurantId, c.u2)))[0]).toEqual({
      categoria: 'Carnes',
      itens: [{ nome: 'Picanha na chapa', precoCentavos: 9500 }, { nome: 'Costela', precoCentavos: 7990 }, { nome: 'Fraldinha', precoCentavos: 6490 }],
    })
    expect((await resumoCardapio(db, c.restaurantId, c.u1))[0]).toEqual({
      categoria: 'Carnes',
      itens: [{ nome: 'Picanha na chapa', precoCentavos: 8990 }, { nome: 'Carne-de-sol', precoCentavos: 5990 }, { nome: 'Fraldinha', precoCentavos: 6490 }],
    })
  })

  it("todas as unidades: só o que está disponível em alguma unidade ativa; preço efetivo único ou 'varia'", async () => {
    const c = await cenario()
    const r = await withRole(db, 'worker_app', (tx) => resumoCardapio(tx, c.restaurantId, 'todas'))
    expect(r).toEqual([
      {
        categoria: 'Carnes',
        // picanha: 89,90 na Asa Sul e 95,00 na Asa Norte; carne-de-sol só na Asa Sul; costela só na Asa Norte; cupim em nenhuma
        itens: [
          { nome: 'Picanha na chapa', precoCentavos: null, precoVaria: true },
          { nome: 'Carne-de-sol', precoCentavos: 5990 },
          { nome: 'Costela', precoCentavos: 7990 },
        ],
      },
      { categoria: 'Saladas', itens: [{ nome: 'Salada caprese', precoCentavos: null }, { nome: 'Salada verde', precoCentavos: 3000 }] },
      { categoria: 'Bebidas', itens: [{ nome: 'Refrigerante lata', precoCentavos: 700 }] },
    ])
    // preço sob consulta numa unidade e com preço na outra também varia
    await db.insert(menuItemUnits).values({ restaurantId: c.restaurantId, itemId: c.id('Refrigerante lata'), unitId: c.u2, precoOverrideCentavos: null, disponivel: true })
    await db.update(menuItems).set({ precoCentavos: null }).where(eq(menuItems.id, c.id('Refrigerante lata')))
    await db.update(menuItemUnits).set({ precoOverrideCentavos: 800 }).where(eq(menuItemUnits.itemId, c.id('Refrigerante lata')))
    const bebidas = (await resumoCardapio(db, c.restaurantId, 'todas')).find((x) => x.categoria === 'Bebidas')!
    expect(bebidas.itens).toEqual([{ nome: 'Refrigerante lata', precoCentavos: null, precoVaria: true }])
  })

  it('todas as unidades sem unidade ativa: cai no padrão', async () => {
    const c = await cenario()
    await db.update(units).set({ ativo: false }).where(eq(units.restaurantId, c.restaurantId))
    expect(await resumoCardapio(db, c.restaurantId, 'todas')).toEqual(await resumoCardapio(db, c.restaurantId, null))
  })
})

