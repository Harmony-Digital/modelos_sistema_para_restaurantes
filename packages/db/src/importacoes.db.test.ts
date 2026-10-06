import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import type { RascunhoCardapio } from '@atd/core/s4'
import { getTestDb, resetDb, seedRestaurant, seedStaff } from './test-utils.ts'
import { withRole, type JwtClaims } from './rls.ts'
import {
  aplicarRascunho, concluirIngestao, criarImportacao, lerImportacao, listarImportacoes, marcarProcessando, rejeitarImportacao,
} from './importacoes.ts'
import { auditLog, knowledgeDocuments, menuCategories, menuFiles, menuItems, menuItemUnits, staff, units } from './schema/index.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const as = (sub: string, aal: 'aal1' | 'aal2' = 'aal2'): JwtClaims => ({ sub, role: 'authenticated', aal })
const SHA = 'e'.repeat(64)

const item = (nome: string, o: Partial<RascunhoCardapio['categorias'][number]['itens'][number]> = {}) => ({
  nome, descricao: null, precoCentavos: 1000, tags: [], outrosNomes: [], unidade: null, incluir: true, ...o,
})
const RASCUNHO: RascunhoCardapio = {
  categorias: [
    { nome: 'CARNES', itens: [
      item('picanha ', { precoCentavos: 6490, descricao: 'Nova descrição', tags: ['sem_gluten'], outrosNomes: ['pica'] }),
      item('Fraldinha', { precoCentavos: 4990 }),
      item('Maminha', { incluir: false }),
    ] },
    { nome: 'Bebidas', itens: [
      item('Suco de laranja', { precoCentavos: 900, unidade: 'asa norte' }),
      item('Suco de laranja', { precoCentavos: 950, unidade: 'Asa Sul' }),
    ] },
  ],
}

async function cenario() {
  const { restaurantId, unitId: u1 } = await seedRestaurant(db)
  const [u2] = await db.insert(units).values({ restaurantId, nome: 'Asa Norte', slug: 'asa-norte' }).returning()
  const dono = await seedStaff(db, sql, { restaurantId, papel: 'dono' })
  const gerenteU1 = await seedStaff(db, sql, { restaurantId, papel: 'gerente' })
  await db.update(staff).set({ unidadesPermitidas: [u1] }).where(eq(staff.userId, gerenteU1))
  const atendente = await seedStaff(db, sql, { restaurantId, papel: 'atendente' })
  const [carnes] = await db.insert(menuCategories).values({ restaurantId, nome: 'Carnes', ordem: 1 }).returning()
  const [picanha] = await db.insert(menuItems).values({ restaurantId, categoryId: carnes!.id, nome: 'Picanha', precoCentavos: 5990, descricao: 'Antiga' }).returning()
  return { restaurantId, u1, u2: u2!.id, dono, gerenteU1, atendente, carnes: carnes!.id, picanha: picanha!.id }
}
type Cenario = Awaited<ReturnType<typeof cenario>>
const idDe = (r: { ok: boolean; valor?: unknown }) => (r as { valor: { id: string } }).valor.id

const csv = (c: Cenario, draft: unknown = RASCUNHO) =>
  criarImportacao(db, as(c.dono), { storagePath: null, mime: 'text/csv', tamanho: 300, sha256: SHA, origem: 'csv', draft })
const arquivo = (c: Cenario, quem = c.dono) =>
  criarImportacao(db, as(quem), { storagePath: `importacoes/${c.restaurantId}/menu.pdf`, mime: 'application/pdf', tamanho: 50_000, sha256: SHA, origem: 'arquivo' })
const SEM_ARQUIVO = { usarComoArquivoDeEnvio: false, unitIdArquivo: null }

describe('criar e ler importações', () => {
  it('CSV nasce rascunho com o draft; arquivo nasce enviado; audita sem conteúdo', async () => {
    const c = await cenario()
    const a = idDe(await csv(c))
    const b = idDe(await arquivo(c))
    const la = await lerImportacao(db, as(c.dono), a)
    expect(la).toMatchObject({ id: a, origem: 'csv', status: 'rascunho', mime: 'text/csv', tamanho: 300, storagePath: null, erro: null })
    expect(la!.draft!.categorias[0]!.nome).toBe('CARNES')
    expect(await lerImportacao(db, as(c.dono), b)).toMatchObject({ origem: 'arquivo', status: 'enviado', draft: null, storagePath: `importacoes/${c.restaurantId}/menu.pdf` })
    expect((await listarImportacoes(db, as(c.dono))).map((i) => i.id)).toEqual([b, a])
    const logs = await db.select().from(auditLog).where(eq(auditLog.acao, 'cardapio.importacao_criada'))
    expect(logs).toHaveLength(2)
    expect(JSON.stringify(logs.map((l) => l.diff))).not.toContain('Fraldinha')
    const [linha] = await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, a))
    expect(linha).toMatchObject({ alvo: 'cardapio', enviadoPor: c.dono, restaurantId: c.restaurantId })
  })

  it('atendente não cria nem lê; draft inválido é recusado; outro restaurante não vê', async () => {
    const c = await cenario()
    expect(await criarImportacao(db, as(c.atendente, 'aal1'), { storagePath: null, mime: 'text/csv', tamanho: 1, sha256: SHA, origem: 'csv', draft: RASCUNHO }))
      .toEqual({ ok: false, erro: 'sem_permissao' })
    await expect(csv(c, { categorias: [{ nome: '', itens: [] }] })).rejects.toThrow()
    await expect(csv(c, null)).rejects.toThrow()
    const id = idDe(await csv(c))
    expect(await lerImportacao(db, as(c.atendente, 'aal1'), id)).toBeNull()
    const outro = await seedRestaurant(db)
    const donoB = await seedStaff(db, sql, { restaurantId: outro.restaurantId, papel: 'dono' })
    expect(await lerImportacao(db, as(donoB), id)).toBeNull()
    expect(await listarImportacoes(db, as(donoB))).toEqual([])
    // caminho de outro restaurante
    expect(await criarImportacao(db, as(donoB), { storagePath: `importacoes/${c.restaurantId}/x.pdf`, mime: 'application/pdf', tamanho: 1, sha256: SHA, origem: 'arquivo' }))
      .toEqual({ ok: false, erro: 'sem_permissao' })
  })
})

describe('worker: processamento', () => {
  it('marcarProcessando só de enviado; concluirIngestao só de processando', async () => {
    const c = await cenario()
    const id = idDe(await arquivo(c))
    const doCsv = idDe(await csv(c))
    expect(await withRole(db, 'worker_app', (tx) => marcarProcessando(tx, id))).toEqual({
      storagePath: `importacoes/${c.restaurantId}/menu.pdf`, mime: 'application/pdf', restaurantId: c.restaurantId,
    })
    expect(await marcarProcessando(db, id)).toBeNull()
    expect(await marcarProcessando(db, doCsv)).toBeNull()
    expect(await marcarProcessando(db, crypto.randomUUID())).toBeNull()

    await withRole(db, 'worker_app', (tx) => concluirIngestao(tx, id, { ok: true, draft: RASCUNHO }))
    expect(await lerImportacao(db, as(c.dono), id)).toMatchObject({ status: 'rascunho', erro: null, draft: { categorias: expect.any(Array) } })
    // já não está processando: nada muda
    await concluirIngestao(db, id, { ok: false, erro: 'x' })
    expect((await lerImportacao(db, as(c.dono), id))!.status).toBe('rascunho')
  })

  it('erro de leitura ou rascunho inválido ⇒ status erro com mensagem amigável', async () => {
    const c = await cenario()
    const a = idDe(await arquivo(c))
    const b = idDe(await criarImportacao(db, as(c.dono), { storagePath: `importacoes/${c.restaurantId}/b.png`, mime: 'image/png', tamanho: 9, sha256: SHA, origem: 'arquivo' }))
    await marcarProcessando(db, a)
    await marcarProcessando(db, b)
    await concluirIngestao(db, a, { ok: false, erro: 'Não consegui ler esse arquivo.' })
    await concluirIngestao(db, b, { ok: true, draft: { categorias: 'lixo' } })
    expect(await lerImportacao(db, as(c.dono), a)).toMatchObject({ status: 'erro', erro: 'Não consegui ler esse arquivo.', draft: null })
    expect(await lerImportacao(db, as(c.dono), b)).toMatchObject({ status: 'erro', draft: null })
    expect((await lerImportacao(db, as(c.dono), b))!.erro).toMatch(/\S/)
  })
})

describe('aplicarRascunho', () => {
  it('cria categorias e itens novos, atualiza existentes (nome normalizado), aplica preço por unidade, ignora incluir=false', async () => {
    const c = await cenario()
    const id = idDe(await csv(c))
    const r = await aplicarRascunho(db, as(c.dono), id, RASCUNHO, SEM_ARQUIVO)
    expect(r).toEqual({ ok: true, valor: { criados: 2, atualizados: 1 } })

    const cats = await db.select().from(menuCategories).where(eq(menuCategories.restaurantId, c.restaurantId))
    expect(cats.map((x) => x.nome).sort()).toEqual(['Bebidas', 'Carnes'])
    const its = await db.select().from(menuItems).where(eq(menuItems.restaurantId, c.restaurantId))
    expect(its.map((x) => x.nome).sort()).toEqual(['Fraldinha', 'Picanha', 'Suco de laranja'])
    expect(its.find((x) => x.id === c.picanha)).toMatchObject({ nome: 'Picanha', precoCentavos: 6490, descricao: 'Nova descrição', tags: ['sem_gluten'], outrosNomes: ['pica'] })
    const suco = its.find((x) => x.nome === 'Suco de laranja')!
    // item só com preço por unidade: base = primeiro preço; cada unidade ganha seu preço próprio
    expect(suco.precoCentavos).toBe(900)
    const exc = await db.select().from(menuItemUnits).where(eq(menuItemUnits.itemId, suco.id))
    expect(exc.map((e) => [e.unitId, e.precoOverrideCentavos, e.disponivel]).sort()).toEqual(
      [[c.u1, 950, null], [c.u2, 900, null]].sort(),
    )

    const [doc] = await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, id))
    expect(doc).toMatchObject({ status: 'aprovado', revisadoPor: c.dono })
    expect(doc!.revisadoAt).toBeInstanceOf(Date)
    const [log] = await db.select().from(auditLog).where(eq(auditLog.acao, 'cardapio.importacao_aplicada'))
    expect(log).toMatchObject({ entidadeId: id, atorId: c.dono })
    expect(log!.diff).toMatchObject({ criados: 2, atualizados: 1 })
    expect(JSON.stringify(log!.diff)).not.toMatch(/Fraldinha|Picanha|Suco/)
  })

  it('segunda aplicação ⇒ ja_aplicado; rejeitada ⇒ ja_aplicado', async () => {
    const c = await cenario()
    const id = idDe(await csv(c))
    expect((await aplicarRascunho(db, as(c.dono), id, RASCUNHO, SEM_ARQUIVO)).ok).toBe(true)
    expect(await aplicarRascunho(db, as(c.dono), id, RASCUNHO, SEM_ARQUIVO)).toEqual({ ok: false, erro: 'ja_aplicado' })
    const outra = idDe(await csv(c))
    expect(await rejeitarImportacao(db, as(c.dono), outra)).toEqual({ ok: true, valor: null })
    expect((await lerImportacao(db, as(c.dono), outra))!.status).toBe('rejeitado')
    expect(await aplicarRascunho(db, as(c.dono), outra, RASCUNHO, SEM_ARQUIVO)).toEqual({ ok: false, erro: 'ja_aplicado' })
    expect(await rejeitarImportacao(db, as(c.dono), id)).toEqual({ ok: false, erro: 'nao_encontrada' })
    // enviado (ainda não lido) não aplica
    const env = idDe(await arquivo(c))
    expect(await aplicarRascunho(db, as(c.dono), env, RASCUNHO, SEM_ARQUIVO)).toEqual({ ok: false, erro: 'ja_aplicado' })
    expect(await aplicarRascunho(db, as(c.dono), crypto.randomUUID(), RASCUNHO, SEM_ARQUIVO)).toEqual({ ok: false, erro: 'nao_encontrada' })
  })

  it('concorrência: duas aplicações simultâneas ⇒ só uma aplica', async () => {
    const c = await cenario()
    const id = idDe(await csv(c))
    const rs = await Promise.all([
      aplicarRascunho(db, as(c.dono), id, RASCUNHO, SEM_ARQUIVO),
      aplicarRascunho(db, as(c.dono), id, RASCUNHO, SEM_ARQUIVO),
    ])
    expect(rs.filter((r) => r.ok)).toHaveLength(1)
    expect(rs.filter((r) => !r.ok)).toEqual([{ ok: false, erro: 'ja_aplicado' }])
    expect(await db.select().from(menuItems).where(eq(menuItems.restaurantId, c.restaurantId))).toHaveLength(3)
  })

  it('usarComoArquivoDeEnvio cria o arquivo de cardápio a partir do arquivo importado', async () => {
    const c = await cenario()
    const id = idDe(await arquivo(c))
    await marcarProcessando(db, id)
    await concluirIngestao(db, id, { ok: true, draft: RASCUNHO })
    expect(await aplicarRascunho(db, as(c.dono), id, RASCUNHO, { usarComoArquivoDeEnvio: true, unitIdArquivo: c.u2 })).toMatchObject({ ok: true })
    const fs = await db.select().from(menuFiles)
    expect(fs).toEqual([expect.objectContaining({
      restaurantId: c.restaurantId, unitId: c.u2, storagePath: `importacoes/${c.restaurantId}/menu.pdf`, mime: 'application/pdf',
      tamanho: 50_000, sha256: SHA, ativo: true,
    })])
  })

  it('atendente e gerente restrito não aplicam; nada muda', async () => {
    const c = await cenario()
    const id = idDe(await csv(c))
    expect(await aplicarRascunho(db, as(c.atendente, 'aal1'), id, RASCUNHO, SEM_ARQUIVO)).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(await aplicarRascunho(db, as(c.gerenteU1), id, RASCUNHO, SEM_ARQUIVO)).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(await rejeitarImportacao(db, as(c.atendente, 'aal1'), id)).toEqual({ ok: false, erro: 'sem_permissao' })
    expect((await lerImportacao(db, as(c.dono), id))!.status).toBe('rascunho')
    expect(await db.select().from(menuItems).where(eq(menuItems.restaurantId, c.restaurantId))).toHaveLength(1)
  })
})
