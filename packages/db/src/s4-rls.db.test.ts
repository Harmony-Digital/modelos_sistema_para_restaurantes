import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql as dsql } from 'drizzle-orm'
import { getTestDb, resetDb, seedRestaurant, seedStaff } from './test-utils.ts'
import { withRole, withUserContext, type JwtClaims } from './rls.ts'
import { knowledgeDocuments, menuCategories, menuFiles, menuItems, menuItemUnits, staff, units } from './schema/index.ts'

const { db, sql } = getTestDb()
beforeEach(async () => {
  await resetDb(sql)
  // objetos de teste no Storage (o Supabase bloqueia DELETE direto sem esta flag)
  await sql.begin(async (tx) => {
    await tx`select set_config('storage.allow_delete_query', 'true', true)`
    await tx`delete from storage.objects where bucket_id in ('cardapio', 'importacoes')`
  })
})
afterAll(() => sql.end())

const as = (sub: string, aal: 'aal1' | 'aal2' = 'aal2'): JwtClaims => ({ sub, role: 'authenticated', aal })
const negado = { cause: { code: '42501' } }
const TABELAS = ['menu_categories', 'menu_items', 'menu_item_units', 'menu_files', 'knowledge_documents']

async function cenario() {
  const a = await seedRestaurant(db)
  const [u2] = await db.insert(units).values({ restaurantId: a.restaurantId, nome: 'Norte', slug: 'norte' }).returning()
  const dono = await seedStaff(db, sql, { restaurantId: a.restaurantId, papel: 'dono' })
  const gerente = await seedStaff(db, sql, { restaurantId: a.restaurantId, papel: 'gerente' })
  await db.update(staff).set({ unidadesPermitidas: [a.unitId] }).where(eq(staff.userId, gerente))
  const atendente = await seedStaff(db, sql, { restaurantId: a.restaurantId, papel: 'atendente' })
  const [cat] = await db.insert(menuCategories).values({ restaurantId: a.restaurantId, nome: 'Carnes' }).returning()
  const [item] = await db.insert(menuItems).values({ restaurantId: a.restaurantId, categoryId: cat!.id, nome: 'Picanha', precoCentavos: 100 }).returning()
  await db.insert(menuItemUnits).values([
    { restaurantId: a.restaurantId, itemId: item!.id, unitId: a.unitId, disponivel: false },
    { restaurantId: a.restaurantId, itemId: item!.id, unitId: u2!.id, precoOverrideCentavos: 200 },
  ])
  const f = { restaurantId: a.restaurantId, titulo: 'C', mime: 'application/pdf', tamanho: 1 }
  await db.insert(menuFiles).values([
    { ...f, unitId: null, storagePath: `cardapio/${a.restaurantId}/g.pdf`, sha256: '1'.repeat(64) },
    { ...f, unitId: a.unitId, storagePath: `cardapio/${a.restaurantId}/a.pdf`, sha256: '2'.repeat(64) },
    { ...f, unitId: u2!.id, storagePath: `cardapio/${a.restaurantId}/n.pdf`, sha256: '3'.repeat(64) },
  ])
  const [doc] = await db.insert(knowledgeDocuments).values({
    restaurantId: a.restaurantId, origem: 'csv', status: 'rascunho', mime: 'text/csv', tamanho: 1, sha256: '4'.repeat(64), draft: { categorias: [] },
  }).returning()
  return { ...a, u2: u2!.id, dono, gerente, atendente, cat: cat!.id, item: item!.id, doc: doc!.id }
}

describe('RLS do cardápio e das importações', () => {
  it('RLS ligada; policies por unidade usam funções de initplan, nunca can_access_unit', async () => {
    const ts = await sql<{ tablename: string; rowsecurity: boolean }[]>`
      select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename in ${sql(TABELAS)} order by 1`
    expect(ts).toHaveLength(5)
    expect(ts.every((t) => t.rowsecurity)).toBe(true)
    const rows = await sql<{ t: string; name: string; expr: string }[]>`
      select tablename as t, policyname as name, coalesce(qual, '') || ' ' || coalesce(with_check, '') as expr
        from pg_policies where schemaname = 'public' and tablename in ${sql(TABELAS)}
         and policyname not in ('mfa_required', 'app_roles')`
    expect(rows.length).toBeGreaterThanOrEqual(8)
    for (const r of rows) {
      expect(r.expr, `${r.t}.${r.name}`).not.toContain('can_access_unit')
      expect(r.expr, `${r.t}.${r.name}`).toContain('my_restaurant_id')
    }
    for (const t of ['menu_item_units', 'menu_files']) {
      const ws = rows.filter((r) => r.t === t)
      expect(ws.every((r) => r.expr.includes('minhas_unidades')), t).toBe(true)
    }
  })

  it('sem DELETE para ninguém da aplicação', async () => {
    const c = await cenario()
    for (const t of [menuItemUnits, menuItems, menuCategories, menuFiles, knowledgeDocuments]) {
      await expect(withUserContext(db, as(c.dono), (tx) => tx.delete(t))).rejects.toMatchObject(negado)
      await expect(withRole(db, 'worker_app', (tx) => tx.delete(t))).rejects.toMatchObject(negado)
      await expect(withRole(db, 'web_app', (tx) => tx.delete(t))).rejects.toMatchObject(negado)
    }
  })

  it('isola por restaurante e unidade; dono sem MFA não vê; atendente lê o cardápio', async () => {
    const c = await cenario()
    const b = await seedRestaurant(db)
    await db.insert(menuCategories).values({ restaurantId: b.restaurantId, nome: 'Outra' })
    expect(await withUserContext(db, as(c.dono), (tx) => tx.select().from(menuCategories))).toHaveLength(1)
    expect(await withUserContext(db, as(c.dono, 'aal1'), (tx) => tx.select().from(menuItems))).toHaveLength(0)
    expect(await withUserContext(db, as(c.atendente, 'aal1'), (tx) => tx.select().from(menuItems))).toHaveLength(1)
    expect(await withUserContext(db, as(c.dono), (tx) => tx.select().from(menuItemUnits))).toHaveLength(2)
    expect((await withUserContext(db, as(c.gerente), (tx) => tx.select().from(menuItemUnits))).map((x) => x.unitId)).toEqual([c.unitId])
    expect((await withUserContext(db, as(c.gerente), (tx) => tx.select().from(menuFiles))).map((x) => x.unitId).sort()).toEqual([c.unitId, null].sort())
    expect(await withUserContext(db, as(c.dono), (tx) => tx.select().from(menuFiles))).toHaveLength(3)
    // importações: só dono/gerente
    expect(await withUserContext(db, as(c.dono), (tx) => tx.select().from(knowledgeDocuments))).toHaveLength(1)
    expect(await withUserContext(db, as(c.atendente, 'aal1'), (tx) => tx.select().from(knowledgeDocuments))).toHaveLength(0)
  })

  it('grants por coluna: authenticated não troca restaurante/categoria por fora nem mexe no cache de mídia', async () => {
    const c = await cenario()
    const b = await seedRestaurant(db)
    await expect(withUserContext(db, as(c.dono), (tx) =>
      tx.update(menuItems).set({ restaurantId: b.restaurantId }).where(eq(menuItems.id, c.item)))).rejects.toMatchObject(negado)
    await expect(withUserContext(db, as(c.dono), (tx) =>
      tx.update(menuCategories).set({ restaurantId: b.restaurantId }))).rejects.toMatchObject(negado)
    await expect(withUserContext(db, as(c.dono), (tx) =>
      tx.update(menuFiles).set({ waMediaId: 'x' }))).rejects.toMatchObject(negado)
    await expect(withUserContext(db, as(c.dono), (tx) =>
      tx.update(menuFiles).set({ storagePath: `cardapio/${c.restaurantId}/z.pdf` }))).rejects.toMatchObject(negado)
    await expect(withUserContext(db, as(c.dono), (tx) =>
      tx.update(menuItemUnits).set({ unitId: c.u2 }))).rejects.toMatchObject(negado)
    await expect(withUserContext(db, as(c.dono), (tx) =>
      tx.update(knowledgeDocuments).set({ erro: 'x' }))).rejects.toMatchObject(negado)
    // dono atualiza o que o formulário permite
    const r = await withUserContext(db, as(c.dono), (tx) =>
      tx.update(menuItems).set({ precoCentavos: 300, tags: ['vegano'] }).where(eq(menuItems.id, c.item)).returning({ id: menuItems.id }))
    expect(r).toHaveLength(1)
  })

  it('importação: authenticated só cria enviado/rascunho em nome próprio e só conclui como aprovado/rejeitado', async () => {
    const c = await cenario()
    const ins = (status: string, enviadoPor: string) => withUserContext(db, as(c.dono), (tx) => tx.execute(dsql`
      insert into public.knowledge_documents (restaurant_id, origem, status, storage_path, mime, tamanho, sha256, enviado_por)
      values (${c.restaurantId}, 'arquivo', ${status}::public.knowledge_document_status, ${`importacoes/${c.restaurantId}/a.pdf`}, 'application/pdf', 1, ${'5'.repeat(64)}, ${enviadoPor})`))
    await expect(ins('aprovado', c.dono)).rejects.toMatchObject(negado)
    await expect(ins('enviado', c.gerente)).rejects.toMatchObject(negado)
    await ins('enviado', c.dono)
    await expect(withUserContext(db, as(c.dono), (tx) =>
      tx.update(knowledgeDocuments).set({ status: 'processando' }).where(eq(knowledgeDocuments.id, c.doc)))).rejects.toMatchObject(negado)
    const r = await withUserContext(db, as(c.dono), (tx) =>
      tx.update(knowledgeDocuments).set({ status: 'rejeitado', revisadoPor: c.dono, revisadoAt: new Date() }).where(eq(knowledgeDocuments.id, c.doc)).returning({ id: knowledgeDocuments.id }))
    expect(r).toHaveLength(1)
    // concluída não volta
    const de = await withUserContext(db, as(c.dono), (tx) =>
      tx.update(knowledgeDocuments).set({ status: 'aprovado', revisadoPor: c.dono }).where(eq(knowledgeDocuments.id, c.doc)).returning({ id: knowledgeDocuments.id }))
    expect(de).toHaveLength(0)
  })

  it('worker_app: lê o cardápio, grava só o cache de mídia e o resultado da ingestão', async () => {
    const c = await cenario()
    expect(await withRole(db, 'worker_app', (tx) => tx.select().from(menuItems))).toHaveLength(1)
    await expect(withRole(db, 'worker_app', (tx) => tx.update(menuItems).set({ nome: 'X' }))).rejects.toMatchObject(negado)
    await expect(withRole(db, 'worker_app', (tx) => tx.update(menuFiles).set({ titulo: 'X' }))).rejects.toMatchObject(negado)
    await expect(withRole(db, 'worker_app', (tx) =>
      tx.insert(menuCategories).values({ restaurantId: c.restaurantId, nome: 'Y' }))).rejects.toMatchObject(negado)
    await withRole(db, 'worker_app', (tx) => tx.update(menuFiles).set({ waMediaId: 'm', waMediaExpiresAt: new Date() }))
    await withRole(db, 'worker_app', (tx) => tx.update(knowledgeDocuments).set({ erro: 'x' }))
  })
})

describe('Storage: buckets privados e policies por papel', () => {
  const put = (claims: JwtClaims, bucket: string, name: string) =>
    withUserContext(db, claims, (tx) => tx.execute(dsql`insert into storage.objects (bucket_id, name) values (${bucket}, ${name})`))
  const ler = (claims: JwtClaims, bucket: string) =>
    withUserContext(db, claims, (tx) => tx.execute<{ name: string }>(dsql`select name from storage.objects where bucket_id = ${bucket} order by name`))

  it('buckets cardapio e importacoes existem, privados, com limite de tamanho e tipos', async () => {
    const bs = await sql<{ id: string; public: boolean; file_size_limit: string; allowed_mime_types: string[] }[]>`
      select id, public, file_size_limit, allowed_mime_types from storage.buckets where id in ('cardapio', 'importacoes') order by id`
    expect(bs.map((b) => [b.id, b.public])).toEqual([['cardapio', false], ['importacoes', false]])
    for (const b of bs) {
      expect(Number(b.file_size_limit)).toBe(20 * 1024 * 1024)
      expect(b.allowed_mime_types).toEqual(expect.arrayContaining(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']))
    }
  })

  it('dono e gerente gravam na pasta do restaurante; atendente não grava; ninguém grava em outra pasta; sem MFA não grava', async () => {
    const c = await cenario()
    const b = await seedRestaurant(db)
    for (const bucket of ['cardapio', 'importacoes']) {
      await put(as(c.dono), bucket, `${c.restaurantId}/dono.pdf`)
      await put(as(c.gerente), bucket, `${c.restaurantId}/gerente.pdf`)
      await expect(put(as(c.atendente, 'aal1'), bucket, `${c.restaurantId}/at.pdf`)).rejects.toMatchObject(negado)
      await expect(put(as(c.dono), bucket, `${b.restaurantId}/x.pdf`)).rejects.toMatchObject(negado)
      await expect(put(as(c.dono), bucket, `x.pdf`)).rejects.toMatchObject(negado)
      await expect(put(as(c.dono, 'aal1'), bucket, `${c.restaurantId}/semmfa.pdf`)).rejects.toMatchObject(negado)
    }
  })

  it('equipe lê só a pasta do próprio restaurante; ninguém apaga nem atualiza', async () => {
    const c = await cenario()
    const b = await seedRestaurant(db)
    const donoB = await seedStaff(db, sql, { restaurantId: b.restaurantId, papel: 'dono' })
    await put(as(c.dono), 'cardapio', `${c.restaurantId}/menu.pdf`)
    await put(as(donoB), 'cardapio', `${b.restaurantId}/menu.pdf`)
    expect((await ler(as(c.atendente, 'aal1'), 'cardapio')).map((r) => r.name)).toEqual([`${c.restaurantId}/menu.pdf`])
    expect((await ler(as(donoB), 'cardapio')).map((r) => r.name)).toEqual([`${b.restaurantId}/menu.pdf`])
    expect(await ler(as(c.dono, 'aal1'), 'cardapio')).toHaveLength(0)
    const upd = await withUserContext(db, as(c.dono), (tx) =>
      tx.execute(dsql`update storage.objects set name = ${`${c.restaurantId}/outro.pdf`} where bucket_id = 'cardapio' returning id`))
    expect(upd).toHaveLength(0)
  })
})
