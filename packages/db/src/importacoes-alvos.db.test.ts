import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { and, eq, sql as dsql } from 'drizzle-orm'
import type { RascunhoEspacos, RascunhoHorarios, RascunhoInformacoes, RascunhoSoPrecos } from '@atd/core/importacao'
import type { RascunhoCardapio } from '@atd/core/s4'
import { getTestDb, resetDb, seedRestaurant, seedStaff } from './test-utils.ts'
import { withRole, withUserContext, type JwtClaims } from './rls.ts'
import {
  anexarArquivo, aplicarImportacao, arquivosImportacao, criarImportacaoArquivos, iniciarLeitura, proximoLote, removerArquivo, revisaoImportacao, salvarLote,
} from './importacoes-alvos.ts'
import { concluirIngestao, lerImportacao, listarImportacoes, marcarProcessando, rejeitarImportacao } from './importacoes.ts'
import {
  auditLog, eventSpaces, knowledgeDocumentFiles, knowledgeDocuments, knowledgeFacts, menuCategories, menuItems, staff, unitHourExceptions, unitHours, units,
} from './schema/index.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const as = (sub: string, aal: 'aal1' | 'aal2' = 'aal2'): JwtClaims => ({ sub, role: 'authenticated', aal })
const negado = { cause: { code: '42501' } }
const sha = (n: number) => n.toString(16).padStart(64, '0')
const hashConjunto = (shas: string[]) => createHash('sha256').update([...shas].sort().join(',')).digest('hex')
const idDe = (r: { ok: boolean; valor?: unknown }) => {
  if (!r.ok) throw new Error(`esperava ok: ${JSON.stringify(r)}`)
  return (r as { valor: { id: string } }).valor.id
}

async function cenario() {
  const { restaurantId, unitId: u1 } = await seedRestaurant(db)
  const [u2] = await db.insert(units).values({ restaurantId, nome: 'Asa Norte', slug: 'asa-norte', apelidos: ['norte'] }).returning()
  const dono = await seedStaff(db, sql, { restaurantId, papel: 'dono' })
  const gerente = await seedStaff(db, sql, { restaurantId, papel: 'gerente' })
  const gerenteU1 = await seedStaff(db, sql, { restaurantId, papel: 'gerente' })
  await db.update(staff).set({ unidadesPermitidas: [u1] }).where(eq(staff.userId, gerenteU1))
  const atendente = await seedStaff(db, sql, { restaurantId, papel: 'atendente' })
  return { restaurantId, u1, u2: u2!.id, dono, gerente, gerenteU1, atendente }
}
type Cenario = Awaited<ReturnType<typeof cenario>>

const caminho = (c: Cenario, nome: string) => `importacoes/${c.restaurantId}/${nome}`
const arq = (c: Cenario, n: number, mime = 'image/jpeg') => ({ storagePath: caminho(c, `f${n}.jpg`), mime, tamanho: 1000 + n, sha256: sha(n) })

/** Importação com arquivos, lida e com rascunho (como o worker deixaria). */
async function comRascunho(c: Cenario, alvo: 'cardapio' | 'informacoes' | 'horarios' | 'espacos', draft: unknown, modo: 'completo' | 'so_precos' = 'completo', n = 1) {
  const id = idDe(await criarImportacaoArquivos(db, as(c.dono), { alvo, modo }))
  expect((await anexarArquivo(db, as(c.dono), id, arq(c, n))).ok).toBe(true)
  expect(await iniciarLeitura(db, as(c.dono), id)).toEqual({ ok: true, valor: null })
  expect(await proximoLote(db, id)).not.toBeNull()
  expect(await concluirIngestao(db, id, { ok: true, draft })).toBe('rascunho')
  return id
}

describe('banco: alvos, modo, lotes e arquivos', () => {
  it('enum de alvo recriado e modo novo; checks de modo/CSV; tabela de arquivos com RLS', async () => {
    const { alvos } = (await sql<{ alvos: string[] }[]>`select enum_range(null::knowledge_document_target)::text[] as alvos`)[0]!
    expect(alvos).toEqual(['cardapio', 'informacoes', 'horarios', 'espacos'])
    const { modos } = (await sql<{ modos: string[] }[]>`select enum_range(null::knowledge_document_mode)::text[] as modos`)[0]!
    expect(modos).toEqual(['completo', 'so_precos'])
    const [t] = await sql<{ rowsecurity: boolean }[]>`select rowsecurity from pg_tables where tablename = 'knowledge_document_files'`
    expect(t!.rowsecurity).toBe(true)
    const c = await cenario()
    await expect(db.insert(knowledgeDocuments).values({ restaurantId: c.restaurantId, alvo: 'informacoes', modo: 'so_precos', origem: 'arquivo', status: 'enviado' }))
      .rejects.toMatchObject({ cause: { constraint_name: 'knowledge_documents_modo_ck' } })
    await expect(db.insert(knowledgeDocuments).values({
      restaurantId: c.restaurantId, alvo: 'horarios', origem: 'csv', status: 'rascunho', mime: 'text/csv', tamanho: 1, sha256: sha(1), draft: {},
    })).rejects.toMatchObject({ cause: { constraint_name: 'knowledge_documents_csv_alvo_ck' } })
    // vários arquivos: sem caminho, mime e tamanho na linha principal
    await expect(db.insert(knowledgeDocuments).values({ restaurantId: c.restaurantId, origem: 'arquivo', status: 'enviado', mime: 'image/png' }))
      .rejects.toMatchObject({ cause: { constraint_name: 'knowledge_documents_storage_ck' } })
  })

  it('criar: dono e gerente de todas as unidades; gerente restrito e atendente não; nasce enviado sem arquivos', async () => {
    const c = await cenario()
    const id = idDe(await criarImportacaoArquivos(db, as(c.dono), { alvo: 'informacoes', modo: 'completo' }))
    expect(idDe(await criarImportacaoArquivos(db, as(c.gerente), { alvo: 'cardapio', modo: 'so_precos' }))).not.toBe(id)
    expect(await criarImportacaoArquivos(db, as(c.gerenteU1), { alvo: 'horarios', modo: 'completo' })).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(await criarImportacaoArquivos(db, as(c.atendente, 'aal1'), { alvo: 'horarios', modo: 'completo' })).toEqual({ ok: false, erro: 'sem_permissao' })
    await expect(criarImportacaoArquivos(db, as(c.dono), { alvo: 'espacos', modo: 'so_precos' })).rejects.toThrow()
    const [d] = await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, id))
    expect(d).toMatchObject({ alvo: 'informacoes', modo: 'completo', origem: 'arquivo', status: 'enviado', storagePath: null, mime: null, tamanho: null, sha256: null, loteAtual: 0, lotesTotal: null, enviadoPor: c.dono })
    const [log] = await db.select().from(auditLog).where(eq(auditLog.acao, 'importacao.criada'))
    expect(log).toMatchObject({ entidadeId: id, diff: { alvo: 'informacoes', modo: 'completo' } })
    // o painel continua listando (mime do primeiro arquivo, tamanho somado)
    await anexarArquivo(db, as(c.dono), id, arq(c, 1, 'application/pdf'))
    await anexarArquivo(db, as(c.dono), id, arq(c, 2))
    expect(await lerImportacao(db, as(c.dono), id)).toMatchObject({ alvo: 'informacoes', modo: 'completo', mime: 'application/pdf', tamanho: 2003, arquivos: 2, loteAtual: 0, lotesTotal: null, recebendo: true })
    expect(await arquivosImportacao(db, as(c.dono), id)).toEqual([{ ordem: 1, mime: 'application/pdf', tamanho: 1001 }, { ordem: 2, mime: 'image/jpeg', tamanho: 1002 }])
    expect(await arquivosImportacao(db, as(c.atendente, 'aal1'), id)).toEqual([])
    expect((await listarImportacoes(db, as(c.dono), { alvo: 'informacoes' })).map((i) => i.id)).toEqual([id])
    expect(await listarImportacoes(db, as(c.dono), { alvo: 'espacos' })).toEqual([])
  })

  it('anexar: ordem crescente, até 10, mesmo arquivo uma vez, caminho do próprio restaurante; remover renumera', async () => {
    const c = await cenario()
    const id = idDe(await criarImportacaoArquivos(db, as(c.dono), { alvo: 'cardapio', modo: 'completo' }))
    const ordens = await Promise.all([1, 2, 3].map((n) => anexarArquivo(db, as(c.dono), id, arq(c, n))))
    expect(ordens.map((r) => (r as { valor: { ordem: number } }).valor.ordem).sort()).toEqual([1, 2, 3])
    // repetido: devolve a ordem que já tem
    const ordemDo2 = (await db.select().from(knowledgeDocumentFiles).where(eq(knowledgeDocumentFiles.sha256, sha(2))))[0]!.ordem
    expect(await anexarArquivo(db, as(c.dono), id, arq(c, 2))).toEqual({ ok: true, valor: { ordem: ordemDo2, descartarCaminho: null } })
    // o mesmo conteúdo enviado de novo com outro nome: o objeto novo no Storage deve ser apagado por quem chamou
    expect(await anexarArquivo(db, as(c.dono), id, { ...arq(c, 2), storagePath: caminho(c, 'copia.jpg') }))
      .toEqual({ ok: true, valor: { ordem: ordemDo2, descartarCaminho: caminho(c, 'copia.jpg') } })
    for (let n = 4; n <= 10; n++) expect((await anexarArquivo(db, as(c.dono), id, arq(c, n))).ok).toBe(true)
    expect(await anexarArquivo(db, as(c.dono), id, arq(c, 11))).toEqual({ ok: false, erro: 'limite_arquivos' })
    // remover o 3º: os seguintes sobem uma posição, e cabe mais um
    const [terceiro] = await db.select().from(knowledgeDocumentFiles).where(and(eq(knowledgeDocumentFiles.importacaoId, id), eq(knowledgeDocumentFiles.ordem, 3)))
    expect(await removerArquivo(db, as(c.dono), id, 3)).toEqual({ ok: true, valor: null })
    const fs = await db.select().from(knowledgeDocumentFiles).where(eq(knowledgeDocumentFiles.importacaoId, id)).orderBy(knowledgeDocumentFiles.ordem)
    expect(fs.map((f) => f.ordem)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(fs.map((f) => f.sha256)).not.toContain(terceiro!.sha256)
    expect(await removerArquivo(db, as(c.dono), id, 10)).toEqual({ ok: false, erro: 'nao_encontrada' })
    // caminho de outro restaurante, atendente, gerente restrito, importação inexistente
    const outro = await seedRestaurant(db)
    expect(await anexarArquivo(db, as(c.dono), id, { ...arq(c, 12), storagePath: `importacoes/${outro.restaurantId}/x.jpg` })).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(await anexarArquivo(db, as(c.atendente, 'aal1'), id, arq(c, 12))).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(await anexarArquivo(db, as(c.gerenteU1), id, arq(c, 12))).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(await removerArquivo(db, as(c.gerenteU1), id, 1)).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(await anexarArquivo(db, as(c.dono), crypto.randomUUID(), arq(c, 12))).toEqual({ ok: false, erro: 'nao_encontrada' })
    // tipo que não é PDF/imagem
    await expect(anexarArquivo(db, as(c.dono), id, { ...arq(c, 13), mime: 'text/csv' })).rejects.toThrow()
    expect(await anexarArquivo(db, as(c.dono), id, arq(c, 11))).toEqual({ ok: true, valor: { ordem: 10, descartarCaminho: null } })
  })

  it('RLS dos arquivos: só dono/gerente do restaurante leem; sem MFA nada; web_app sem DELETE', async () => {
    const c = await cenario()
    const id = idDe(await criarImportacaoArquivos(db, as(c.dono), { alvo: 'cardapio', modo: 'completo' }))
    await anexarArquivo(db, as(c.dono), id, arq(c, 1))
    const ler = (cl: JwtClaims) => withUserContext(db, cl, (tx) => tx.select().from(knowledgeDocumentFiles))
    expect(await ler(as(c.dono))).toHaveLength(1)
    expect(await ler(as(c.gerente))).toHaveLength(1)
    expect(await ler(as(c.dono, 'aal1'))).toHaveLength(0)
    expect(await ler(as(c.atendente, 'aal1'))).toHaveLength(0)
    const outro = await seedRestaurant(db)
    const donoB = await seedStaff(db, sql, { restaurantId: outro.restaurantId, papel: 'dono' })
    expect(await ler(as(donoB))).toHaveLength(0)
    expect(await anexarArquivo(db, as(donoB), id, { ...arq(c, 2), storagePath: `importacoes/${outro.restaurantId}/a.jpg` })).toEqual({ ok: false, erro: 'nao_encontrada' })
    await expect(withRole(db, 'web_app', (tx) => tx.delete(knowledgeDocumentFiles))).rejects.toMatchObject(negado)
    await expect(withRole(db, 'worker_app', (tx) => tx.delete(knowledgeDocumentFiles))).rejects.toMatchObject(negado)
    // authenticated não troca a importação nem o restaurante do arquivo
    await expect(withUserContext(db, as(c.dono), (tx) => tx.update(knowledgeDocumentFiles).set({ importacaoId: crypto.randomUUID() }))).rejects.toMatchObject(negado)
  })

  it('iniciar leitura: exige arquivo; depois não anexa nem remove; não inicia duas vezes', async () => {
    const c = await cenario()
    const id = idDe(await criarImportacaoArquivos(db, as(c.dono), { alvo: 'espacos', modo: 'completo' }))
    expect(await iniciarLeitura(db, as(c.dono), id)).toEqual({ ok: false, erro: 'sem_arquivos' })
    await anexarArquivo(db, as(c.dono), id, arq(c, 1))
    await anexarArquivo(db, as(c.dono), id, arq(c, 2))
    expect(await iniciarLeitura(db, as(c.gerenteU1), id)).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(await iniciarLeitura(db, as(c.dono), id)).toEqual({ ok: true, valor: null })
    const [d] = await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, id))
    expect(d).toMatchObject({ status: 'enviado', sha256: hashConjunto([sha(1), sha(2)]) })
    expect(await lerImportacao(db, as(c.dono), id)).toMatchObject({ status: 'enviado', recebendo: false })
    expect(await iniciarLeitura(db, as(c.dono), id)).toEqual({ ok: false, erro: 'ja_iniciada' })
    expect(await anexarArquivo(db, as(c.dono), id, arq(c, 3))).toEqual({ ok: false, erro: 'ja_iniciada' })
    expect(await removerArquivo(db, as(c.dono), id, 1)).toEqual({ ok: false, erro: 'ja_iniciada' })
    // nem por fora (RLS): arquivo novo, troca de ordem ou remoção em importação já iniciada
    await expect(withUserContext(db, as(c.dono), (tx) => tx.execute(dsql`
      insert into public.knowledge_document_files (restaurant_id, importacao_id, ordem, storage_path, mime, tamanho, sha256)
      values (${c.restaurantId}, ${id}, 3, ${caminho(c, 'z.jpg')}, 'image/jpeg', 1, ${sha(9)})`))).rejects.toMatchObject(negado)
    expect(await withUserContext(db, as(c.dono), (tx) => tx.delete(knowledgeDocumentFiles).returning({ id: knowledgeDocumentFiles.id }))).toEqual([])
    // depois de iniciada o painel não troca o hash (nenhuma policy enxerga a linha); nem o banco deixa (gatilho)
    expect(await withUserContext(db, as(c.dono), (tx) =>
      tx.update(knowledgeDocuments).set({ sha256: sha(5) }).where(eq(knowledgeDocuments.id, id)).returning({ id: knowledgeDocuments.id }))).toEqual([])
    await expect(db.update(knowledgeDocuments).set({ sha256: sha(5) }).where(eq(knowledgeDocuments.id, id))).rejects.toMatchObject(negado)
    // nada volta a enviado; importação ainda recebendo arquivos não vai para leitura sem o hash
    const outra = idDe(await criarImportacaoArquivos(db, as(c.dono), { alvo: 'espacos', modo: 'completo' }))
    await expect(db.update(knowledgeDocuments).set({ status: 'processando' }).where(eq(knowledgeDocuments.id, outra))).rejects.toMatchObject(negado)
    await db.update(knowledgeDocuments).set({ status: 'processando' }).where(eq(knowledgeDocuments.id, id))
    await expect(db.update(knowledgeDocuments).set({ status: 'enviado' }).where(eq(knowledgeDocuments.id, id))).rejects.toMatchObject(negado)
  })

  it('dedup do conjunto por alvo e modo (ordem não importa); rejeitada libera; outro alvo não conflita', async () => {
    const c = await cenario()
    const nova = async (alvo: 'informacoes' | 'cardapio', ns: number[], modo: 'completo' | 'so_precos' = 'completo') => {
      const id = idDe(await criarImportacaoArquivos(db, as(c.dono), { alvo, modo }))
      for (const n of ns) await anexarArquivo(db, as(c.dono), id, arq(c, n))
      return { id, r: await iniciarLeitura(db, as(c.dono), id) }
    }
    const a = await nova('informacoes', [1, 2])
    expect(a.r.ok).toBe(true)
    const b = await nova('informacoes', [2, 1])
    expect(b.r).toEqual({ ok: false, erro: 'ja_importado', id: a.id })
    expect((await nova('cardapio', [1, 2])).r.ok).toBe(true)
    expect((await nova('cardapio', [1, 2], 'so_precos')).r.ok).toBe(true)
    expect((await nova('informacoes', [1])).r.ok).toBe(true)
    // simultâneas com o mesmo conjunto: uma lê, a outra aponta para ela
    const ids = await Promise.all([0, 1].map(async () => {
      const id = idDe(await criarImportacaoArquivos(db, as(c.dono), { alvo: 'informacoes', modo: 'completo' }))
      await anexarArquivo(db, as(c.dono), id, arq(c, 7))
      return id
    }))
    const rs = await Promise.all(ids.map((id) => iniciarLeitura(db, as(c.dono), id)))
    expect(rs.filter((r) => r.ok)).toHaveLength(1)
    expect(rs.find((r) => !r.ok)).toMatchObject({ erro: 'ja_importado', id: ids[rs.findIndex((r) => r.ok)] })
    // erro de leitura libera o mesmo conjunto
    await proximoLote(db, a.id)
    await concluirIngestao(db, a.id, { ok: false, erro: 'falhou' })
    expect(await rejeitarImportacao(db, as(c.dono), a.id)).toEqual({ ok: true, valor: null })
    expect(await iniciarLeitura(db, as(c.dono), b.id)).toEqual({ ok: true, valor: null })
  })
})

describe('worker: lotes', () => {
  it('proximoLote só depois de iniciada; passa a processando; salvarLote só avança no lote corrente', async () => {
    const c = await cenario()
    const id = idDe(await criarImportacaoArquivos(db, as(c.dono), { alvo: 'cardapio', modo: 'completo' }))
    await anexarArquivo(db, as(c.dono), id, arq(c, 1, 'application/pdf'))
    await anexarArquivo(db, as(c.dono), id, arq(c, 2))
    expect(await proximoLote(db, id)).toBeNull() // ainda recebendo arquivos
    // a importação de um arquivo só (Etapa 05) não confunde com a nova forma, e vice-versa
    expect(await marcarProcessando(db, id)).toBeNull()
    await iniciarLeitura(db, as(c.dono), id)
    expect(await marcarProcessando(db, id)).toBeNull()
    const p = await withRole(db, 'worker_app', (tx) => proximoLote(tx, id))
    expect(p).toEqual({
      alvo: 'cardapio', modo: 'completo', restaurantId: c.restaurantId, loteAtual: 0, lotesTotal: null, draftParcial: null, retomada: false,
      arquivos: [
        { ordem: 1, storagePath: caminho(c, 'f1.jpg'), mime: 'application/pdf', tamanho: 1001, sha256: sha(1), paginas: null },
        { ordem: 2, storagePath: caminho(c, 'f2.jpg'), mime: 'image/jpeg', tamanho: 1002, sha256: sha(2), paginas: null },
      ],
    })
    expect((await lerImportacao(db, as(c.dono), id))!.status).toBe('processando')
    await withRole(db, 'worker_app', (tx) => salvarLote(tx, id, { lote: 0, lotesTotal: 3, draftParcial: { parte: 1 } }))
    await salvarLote(db, id, { lote: 0, lotesTotal: 3, draftParcial: { parte: 'repetido' } }) // reentrega: nada muda
    await salvarLote(db, id, { lote: 2, lotesTotal: 3, draftParcial: { parte: 'fora' } }) // pulando: nada muda
    expect(await proximoLote(db, id)).toMatchObject({ loteAtual: 1, lotesTotal: 3, draftParcial: { parte: 1 } })
    await salvarLote(db, id, { lote: 1, lotesTotal: 3, draftParcial: { parte: 2 } })
    expect(await lerImportacao(db, as(c.dono), id)).toMatchObject({ status: 'processando', loteAtual: 2, lotesTotal: 3 })
    // worker grava páginas, nunca o caminho
    await withRole(db, 'worker_app', (tx) => tx.update(knowledgeDocumentFiles).set({ paginas: 12 }).where(eq(knowledgeDocumentFiles.importacaoId, id)))
    await expect(withRole(db, 'worker_app', (tx) => tx.update(knowledgeDocumentFiles).set({ storagePath: caminho(c, 'x.pdf') }))).rejects.toMatchObject(negado)
    // concluir limpa o parcial
    await concluirIngestao(db, id, { ok: true, draft: { categorias: [{ nome: 'Carnes', itens: [{ nome: 'Picanha', descricao: null, precoCentavos: 100, tags: [], outrosNomes: [], unidade: null, incluir: true }] }] } })
    const [d] = await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, id))
    expect(d).toMatchObject({ status: 'rascunho', draftParcial: null })
    expect(await proximoLote(db, id)).toBeNull()
  })

  it('concluirIngestao valida pelo schema do alvo e recusa rascunho vazio com mensagem do alvo', async () => {
    const c = await cenario()
    const mk = async (alvo: 'informacoes' | 'horarios' | 'espacos' | 'cardapio', modo: 'completo' | 'so_precos', n: number) => {
      const id = idDe(await criarImportacaoArquivos(db, as(c.dono), { alvo, modo }))
      await anexarArquivo(db, as(c.dono), id, arq(c, n))
      await iniciarLeitura(db, as(c.dono), id)
      await proximoLote(db, id)
      return id
    }
    const a = await mk('informacoes', 'completo', 1)
    expect(await concluirIngestao(db, a, { ok: true, draft: { fatos: [] } })).toBe('erro')
    expect((await lerImportacao(db, as(c.dono), a))!.erro).toBe('Não encontrei informações nesse arquivo.')
    const b = await mk('horarios', 'completo', 2)
    expect(await concluirIngestao(db, b, { ok: true, draft: { categorias: [] } })).toBe('erro') // formato de outro alvo
    const e = await mk('espacos', 'completo', 3)
    expect(await concluirIngestao(db, e, { ok: true, draft: { espacos: [] } })).toBe('erro')
    expect((await lerImportacao(db, as(c.dono), e))!.erro).toBe('Não encontrei espaços de evento nesse arquivo.')
    const p = await mk('cardapio', 'so_precos', 4)
    expect(await concluirIngestao(db, p, { ok: true, draft: { itens: [{ nome: 'Picanha', categoria: null, precoCentavos: 100 }] } })).toBe('rascunho')
  })
})

// ---------- aplicação por alvo ----------

const fato = (tema: string, o: Partial<RascunhoInformacoes['fatos'][number]> = {}) => ({
  tema, texto: `Texto de ${tema}`, exemplos: [], unidade: null, incluir: true, ...o,
})
const hojeIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
const diaIso = (deslocamento: number) => {
  const d = new Date(`${hojeIso()}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + deslocamento)
  return d.toISOString().slice(0, 10)
}

describe('aplicar informações', () => {
  it('novo e atualizar por tema normalizado + unidade; incluir=false e unidade desconhecida ignorados; auditoria sem conteúdo', async () => {
    const c = await cenario()
    const [existente] = await db.insert(knowledgeFacts).values({ restaurantId: c.restaurantId, tema: 'Estacionamento', texto: 'Antigo', exemplos: ['tem vaga?'] }).returning()
    const [daU2] = await db.insert(knowledgeFacts).values({ restaurantId: c.restaurantId, unitId: c.u2, tema: 'Wi-Fi', texto: 'Senha antiga' }).returning()
    const r: RascunhoInformacoes = { fatos: [
      fato('  estacionamento ', { texto: 'Valet na porta', exemplos: [] }),
      fato('WI-FI', { unidade: 'norte', texto: 'Senha nova' }),
      fato('Wi-Fi', { texto: 'Rede geral' }), // geral: não é o fato da Asa Norte
      fato('Pet friendly', { incluir: false }),
      fato('Rodízio', { unidade: 'Lago Sul' }),
    ] }
    const id = await comRascunho(c, 'informacoes', r)
    const rev = await revisaoImportacao(db, as(c.dono), id)
    expect(rev).toMatchObject({ alvo: 'informacoes', status: 'rascunho' })
    expect(rev!.draft).toMatchObject({ fatos: [{ tema: 'estacionamento' }, { tema: 'WI-FI' }, {}, {}, {}] })
    expect(rev!.alvo === 'informacoes' && rev!.fatos).toEqual([
      { acao: 'atualizar', factId: existente!.id, unitId: null },
      { acao: 'atualizar', factId: daU2!.id, unitId: c.u2 },
      { acao: 'novo', factId: null, unitId: null },
      { acao: 'ignorar', factId: null, unitId: null },
      { acao: 'unidade_desconhecida', factId: null, unitId: null },
    ])
    expect(await aplicarImportacao(db, as(c.dono), id, r)).toEqual({ ok: true, valor: { criados: 1, atualizados: 2, ignorados: 2 } })
    const fs = await db.select().from(knowledgeFacts).where(eq(knowledgeFacts.restaurantId, c.restaurantId))
    expect(fs).toHaveLength(3)
    expect(fs.find((f) => f.id === existente!.id)).toMatchObject({ tema: 'Estacionamento', texto: 'Valet na porta', exemplos: ['tem vaga?'] })
    expect(fs.find((f) => f.id === daU2!.id)).toMatchObject({ texto: 'Senha nova', unitId: c.u2 })
    expect(fs.find((f) => f.texto === 'Rede geral')).toMatchObject({ tema: 'Wi-Fi', unitId: null, ativo: true })
    const [doc] = await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, id))
    expect(doc).toMatchObject({ status: 'aprovado', revisadoPor: c.dono })
    const [log] = await db.select().from(auditLog).where(eq(auditLog.acao, 'importacao.aplicada'))
    expect(log).toMatchObject({ entidadeId: id, diff: { alvo: 'informacoes', modo: 'completo', criados: 1, atualizados: 2, ignorados: 2 } })
    expect(JSON.stringify(log!.diff)).not.toMatch(/Valet|Senha|Rede|Estacionamento/)
  })

  it('segunda aplicação, concorrência, permissão, rascunho inválido e transação', async () => {
    const c = await cenario()
    const r: RascunhoInformacoes = { fatos: [fato('Estacionamento'), fato('Explode')] }
    const id = await comRascunho(c, 'informacoes', r)
    expect(await aplicarImportacao(db, as(c.gerenteU1), id, r)).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(await aplicarImportacao(db, as(c.atendente, 'aal1'), id, r)).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(await aplicarImportacao(db, as(c.dono), id, { fatos: [{ tema: '' }] })).toEqual({ ok: false, erro: 'rascunho_invalido' })
    expect(await aplicarImportacao(db, as(c.dono), id, { categorias: [] })).toEqual({ ok: false, erro: 'rascunho_invalido' })
    // falha no meio (gatilho de teste no 2º fato) desfaz tudo
    await sql.unsafe(`
      create function public.t_explode() returns trigger language plpgsql as $$ begin
        if new.tema = 'Explode' then raise exception 'explodiu'; end if; return new; end $$;
      create trigger t_explode before insert on public.knowledge_facts for each row execute function public.t_explode();`)
    await expect(aplicarImportacao(db, as(c.dono), id, r)).rejects.toThrow()
    expect(await db.select().from(knowledgeFacts)).toEqual([])
    expect((await lerImportacao(db, as(c.dono), id))!.status).toBe('rascunho')
    await sql.unsafe('drop trigger t_explode on public.knowledge_facts; drop function public.t_explode();')
    // clique duplo / dois gerentes: aplica uma vez
    const rs = await Promise.all([aplicarImportacao(db, as(c.dono), id, r), aplicarImportacao(db, as(c.gerente), id, r)])
    expect(rs.filter((x) => x.ok)).toHaveLength(1)
    expect(rs.filter((x) => !x.ok)).toEqual([{ ok: false, erro: 'ja_aplicado' }])
    expect(await db.select().from(knowledgeFacts)).toHaveLength(2)
    expect(await aplicarImportacao(db, as(c.dono), id, r)).toEqual({ ok: false, erro: 'ja_aplicado' })
    expect(await aplicarImportacao(db, as(c.dono), crypto.randomUUID(), r)).toEqual({ ok: false, erro: 'nao_encontrada' })
  })
})

describe('aplicar horários', () => {
  const turno = (abre: string, fecha: string) => ({ abre, fecha })
  const unidade = (nome: string, o: Partial<RascunhoHorarios['unidades'][number]> = {}): RascunhoHorarios['unidades'][number] => {
    const semana = [
      { dia: 5, turnos: [turno('11:30', '15:00'), turno('19:00', '01:00')], conflito: false },
      { dia: 6, turnos: [turno('12:00', '16:00')], conflito: false },
    ]
    return { unidade: nome, semana, excecoes: [], incluir: true, ...o }
  }

  it('unidade não reconhecida sem escolha é recusada; escolhida aplica; só as marcadas mudam; exceções por data ≥ hoje', async () => {
    const c = await cenario()
    await db.insert(unitHours).values([
      { restaurantId: c.restaurantId, unitId: c.u1, weekday: 1, turno: 1, abre: '10:00', fecha: '14:00' },
      { restaurantId: c.restaurantId, unitId: c.u2, weekday: 1, turno: 1, abre: '09:00', fecha: '13:00' },
    ])
    await db.insert(unitHourExceptions).values({ restaurantId: c.restaurantId, unitId: c.u1, data: diaIso(3), fechado: true, motivo: 'Reforma' })
    const r: RascunhoHorarios = { unidades: [
      unidade('asa sul', { excecoes: [
        { data: diaIso(3), fechado: false, turnos: [turno('18:00', '23:00')], motivo: 'Evento', conflito: false },
        { data: diaIso(10), fechado: true, turnos: [], motivo: 'Feriado local', conflito: false },
        { data: diaIso(-2), fechado: true, turnos: [], motivo: 'Passou', conflito: false },
      ] }),
      unidade('Unidade Lago', { semana: [{ dia: 1, turnos: [turno('08:00', '12:00')], conflito: false }] }),
      unidade('Norte', { incluir: false }),
    ] }
    const id = await comRascunho(c, 'horarios', r)
    const rev = await revisaoImportacao(db, as(c.dono), id)
    expect(rev!.alvo === 'horarios' && rev!.unidades).toEqual([
      { unitId: c.u1, reconhecida: true, acao: 'atualizar' },
      { unitId: null, reconhecida: false, acao: 'escolher_unidade' },
      { unitId: c.u2, reconhecida: true, acao: 'ignorar' },
    ])
    // Review Focus 1: confirmar sem escolher a unidade é recusado e nada muda
    expect(await aplicarImportacao(db, as(c.dono), id, r)).toEqual({ ok: false, erro: 'unidade_nao_escolhida' })
    expect(await db.select().from(unitHours).where(eq(unitHours.unitId, c.u1))).toHaveLength(1)
    // gerente restrito não aplica nem na própria unidade
    const soU1 = { unidades: [r.unidades[0]!] }
    expect(await aplicarImportacao(db, as(c.gerenteU1), id, soU1)).toEqual({ ok: false, erro: 'sem_permissao' })
    // a revisão troca o nome lido pela unidade escolhida (Asa Norte) e "Norte" segue desmarcada
    const escolhido: RascunhoHorarios = { unidades: [r.unidades[0]!, { ...r.unidades[1]!, unidade: 'Asa Norte' }, r.unidades[2]!] }
    expect(await aplicarImportacao(db, as(c.dono), id, escolhido)).toEqual({ ok: true, valor: { criados: 1, atualizados: 3, ignorados: 2 } })
    const h1 = await db.select().from(unitHours).where(eq(unitHours.unitId, c.u1))
    expect(h1.map((h) => [h.weekday, h.turno, h.abre, h.fecha]).sort()).toEqual([
      [5, 1, '11:30:00', '15:00:00'], [5, 2, '19:00:00', '01:00:00'], [6, 1, '12:00:00', '16:00:00'],
    ])
    // a semana da unidade marcada é substituída inteira (o turno antigo de segunda some)
    const h2 = await db.select().from(unitHours).where(eq(unitHours.unitId, c.u2))
    expect(h2.map((h) => [h.weekday, h.turno, h.abre, h.fecha])).toEqual([[1, 1, '08:00:00', '12:00:00']])
    const ex = await db.select().from(unitHourExceptions).where(eq(unitHourExceptions.unitId, c.u1))
    expect(ex.map((e) => [e.data, e.fechado, e.turnos, e.motivo]).sort()).toEqual([
      [diaIso(10), true, [], 'Feriado local'], [diaIso(3), false, [turno('18:00', '23:00')], 'Evento'],
    ].sort())
    const [log] = await db.select().from(auditLog).where(eq(auditLog.acao, 'importacao.aplicada'))
    expect(JSON.stringify(log!.diff)).not.toMatch(/Evento|Feriado|11:30/)
  })

  it('semana vazia não mexe na grade (só exceções); unidade não lida (null) exige escolha', async () => {
    const c = await cenario()
    await db.insert(unitHours).values({ restaurantId: c.restaurantId, unitId: c.u1, weekday: 1, turno: 1, abre: '10:00', fecha: '14:00' })
    const r: RascunhoHorarios = { unidades: [unidade('Asa Sul', { semana: [], excecoes: [{ data: diaIso(1), fechado: true, turnos: [], motivo: null, conflito: false }] })] }
    const id = await comRascunho(c, 'horarios', r)
    expect(await aplicarImportacao(db, as(c.dono), id, { unidades: [...r.unidades, unidade('x', { unidade: null })] })).toEqual({ ok: false, erro: 'unidade_nao_escolhida' })
    expect(await aplicarImportacao(db, as(c.dono), id, r)).toEqual({ ok: true, valor: { criados: 1, atualizados: 0, ignorados: 0 } })
    expect(await db.select().from(unitHours).where(eq(unitHours.unitId, c.u1))).toHaveLength(1)
  })
})

describe('aplicar espaços', () => {
  const espaco = (nome: string, o: Partial<RascunhoEspacos['espacos'][number]> = {}) => ({
    nome, capacidadeMin: 10, capacidadeMax: 40, descricao: null, condicoes: null, unidade: 'Asa Sul', incluir: true, ...o,
  })

  it('novo e atualizar por nome normalizado na unidade; sem unidade recusa; capacidade inválida é rascunho inválido', async () => {
    const c = await cenario()
    const [salao] = await db.insert(eventSpaces).values({ restaurantId: c.restaurantId, unitId: c.u1, nome: 'Salão Nobre', capacidadeMin: 5, capacidadeMax: 20, descricao: 'Antiga' }).returning()
    const r: RascunhoEspacos = { espacos: [
      espaco('salao nobre', { capacidadeMax: 60, descricao: 'Nova' }),
      espaco('Salão Nobre', { unidade: 'norte' }), // mesmo nome, outra unidade: novo
      espaco('Varanda', { incluir: false }),
    ] }
    const id = await comRascunho(c, 'espacos', r)
    const rev = await revisaoImportacao(db, as(c.dono), id)
    expect(rev!.alvo === 'espacos' && rev!.espacos).toEqual([
      { acao: 'atualizar', unitId: c.u1, spaceId: salao!.id },
      { acao: 'novo', unitId: c.u2, spaceId: null },
      { acao: 'ignorar', unitId: c.u1, spaceId: null },
    ])
    const ruim = { espacos: [espaco('X', { capacidadeMin: 50, capacidadeMax: 10 })] }
    expect(await aplicarImportacao(db, as(c.dono), id, ruim)).toEqual({ ok: false, erro: 'rascunho_invalido' })
    const semUnidade = { espacos: [...r.espacos, espaco('Terraço', { unidade: 'Lago Sul' })] }
    expect(await aplicarImportacao(db, as(c.dono), id, semUnidade)).toEqual({ ok: false, erro: 'unidade_nao_escolhida' })
    expect(await aplicarImportacao(db, as(c.dono), id, r)).toEqual({ ok: true, valor: { criados: 1, atualizados: 1, ignorados: 1 } })
    const es = await db.select().from(eventSpaces).where(eq(eventSpaces.restaurantId, c.restaurantId))
    expect(es).toHaveLength(2)
    expect(es.find((e) => e.id === salao!.id)).toMatchObject({ nome: 'Salão Nobre', capacidadeMin: 10, capacidadeMax: 60, descricao: 'Nova' })
    expect(es.find((e) => e.unitId === c.u2)).toMatchObject({ nome: 'Salão Nobre', ativo: true })
    expect(await aplicarImportacao(db, as(c.dono), id, r)).toEqual({ ok: false, erro: 'ja_aplicado' })
  })
})

describe('aplicar cardápio', () => {
  async function cardapio(c: Cenario) {
    const [carnes] = await db.insert(menuCategories).values({ restaurantId: c.restaurantId, nome: 'Carnes', ordem: 1 }).returning()
    const [bebidas] = await db.insert(menuCategories).values({ restaurantId: c.restaurantId, nome: 'Bebidas', ordem: 2 }).returning()
    const [picanha] = await db.insert(menuItems).values({ restaurantId: c.restaurantId, categoryId: carnes!.id, nome: 'Picanha', precoCentavos: 5990 }).returning()
    const [fraldinha] = await db.insert(menuItems).values({ restaurantId: c.restaurantId, categoryId: carnes!.id, nome: 'Fraldinha', precoCentavos: 4990 }).returning()
    const [sucoC] = await db.insert(menuItems).values({ restaurantId: c.restaurantId, categoryId: carnes!.id, nome: 'Suco', precoCentavos: 800 }).returning()
    const [sucoB] = await db.insert(menuItems).values({ restaurantId: c.restaurantId, categoryId: bebidas!.id, nome: 'Suco', precoCentavos: 900 }).returning()
    return { picanha: picanha!.id, fraldinha: fraldinha!.id, sucoC: sucoC!.id, sucoB: sucoB!.id }
  }

  it('só preços: muda só preco_centavos de existentes; sem preço não zera; novo e ambíguo ignorados (Review Focus 4)', async () => {
    const c = await cenario()
    const m = await cardapio(c)
    const r: RascunhoSoPrecos = { itens: [
      { nome: 'PICANHA', categoria: null, precoCentavos: 6490, incluir: true },
      { nome: 'Fraldinha', categoria: 'carnes', precoCentavos: null, incluir: true },
      { nome: 'Cupim', categoria: null, precoCentavos: 3990, incluir: true },
      { nome: 'Suco', categoria: null, precoCentavos: 1000, incluir: true }, // existe em duas categorias
      { nome: 'Suco', categoria: 'Bebidas', precoCentavos: 900, incluir: true }, // mesmo preço: sem mudança
      { nome: 'Picanha', categoria: 'Carnes', precoCentavos: 1, incluir: false },
    ] }
    const id = await comRascunho(c, 'cardapio', r, 'so_precos')
    const rev = await revisaoImportacao(db, as(c.dono), id)
    expect(rev).toMatchObject({ alvo: 'cardapio', modo: 'so_precos' })
    expect(rev!.alvo === 'cardapio' && rev!.modo === 'so_precos' && { mudancas: rev!.mudancas, ignorados: rev!.ignorados }).toEqual({
      mudancas: [{ indice: 0, itemId: m.picanha, nome: 'Picanha', categoria: 'Carnes', antes: 5990, depois: 6490 }],
      ignorados: [
        { indice: 1, nome: 'Fraldinha', motivo: 'sem_preco' },
        { indice: 2, nome: 'Cupim', motivo: 'nao_encontrado' },
        { indice: 3, nome: 'Suco', motivo: 'ambiguo' },
        { indice: 4, nome: 'Suco', motivo: 'sem_mudanca' },
        { indice: 5, nome: 'Picanha', motivo: 'desmarcado' },
      ],
    })
    expect(await aplicarImportacao(db, as(c.dono), id, r)).toEqual({ ok: true, valor: { criados: 0, atualizados: 1, ignorados: 5 } })
    const its = await db.select().from(menuItems).where(eq(menuItems.restaurantId, c.restaurantId))
    expect(Object.fromEntries(its.map((i) => [i.id, i.precoCentavos]))).toEqual({ [m.picanha]: 6490, [m.fraldinha]: 4990, [m.sucoC]: 800, [m.sucoB]: 900 })
    expect(its).toHaveLength(4)
    expect(its.find((i) => i.id === m.picanha)!.nome).toBe('Picanha')
  })

  it('cardápio completo com vários arquivos aplica como na Etapa 05 (rótulos novo/atualizar na revisão)', async () => {
    const c = await cenario()
    await cardapio(c)
    const item = (nome: string, preco: number | null) => ({ nome, descricao: null, precoCentavos: preco, tags: [], outrosNomes: [], unidade: null, incluir: true })
    const r: RascunhoCardapio = { categorias: [{ nome: 'carnes', itens: [item('picanha', 7000), item('Cupim', 3990)] }, { nome: 'Sobremesas', itens: [item('Pudim', 1500)] }] }
    const id = await comRascunho(c, 'cardapio', r)
    const rev = await revisaoImportacao(db, as(c.dono), id)
    expect(rev!.alvo === 'cardapio' && rev!.modo === 'completo' && rev!.itens).toEqual([
      { categoria: 0, item: 0, acao: 'atualizar' }, { categoria: 0, item: 1, acao: 'novo' }, { categoria: 1, item: 0, acao: 'novo' },
    ])
    expect(await aplicarImportacao(db, as(c.dono), id, r)).toEqual({ ok: true, valor: { criados: 2, atualizados: 1, ignorados: 0 } })
    expect((await db.select().from(menuItems).where(eq(menuItems.restaurantId, c.restaurantId))).length).toBe(6)
  })

  it('revisão: atendente e outro restaurante não veem; enviado sem rascunho vem sem draft', async () => {
    const c = await cenario()
    const id = idDe(await criarImportacaoArquivos(db, as(c.dono), { alvo: 'informacoes', modo: 'completo' }))
    expect(await revisaoImportacao(db, as(c.dono), id)).toMatchObject({ alvo: 'informacoes', status: 'enviado', draft: null, fatos: [] })
    expect(await revisaoImportacao(db, as(c.atendente, 'aal1'), id)).toBeNull()
    const outro = await seedRestaurant(db)
    const donoB = await seedStaff(db, sql, { restaurantId: outro.restaurantId, papel: 'dono' })
    expect(await revisaoImportacao(db, as(donoB), id)).toBeNull()
  })
})

describe('fix round 1', () => {
  it('concessão do lote: duas leituras simultâneas ⇒ só uma recebe o lote; salvarLote devolve se salvou e libera', async () => {
    const c = await cenario()
    const id = idDe(await criarImportacaoArquivos(db, as(c.dono), { alvo: 'informacoes', modo: 'completo' }))
    await anexarArquivo(db, as(c.dono), id, arq(c, 1))
    await iniciarLeitura(db, as(c.dono), id)
    const [a, b] = await Promise.all([proximoLote(db, id), proximoLote(db, id)])
    expect([a, b].filter((x) => x !== null)).toHaveLength(1)
    expect(await proximoLote(db, id)).toBeNull() // concessão viva: ninguém mais lê
    expect(await withRole(db, 'worker_app', (tx) => salvarLote(tx, id, { lote: 0, lotesTotal: 3, draftParcial: { p: 1 } }))).toBe(true)
    expect(await salvarLote(db, id, { lote: 0, lotesTotal: 3, draftParcial: { p: 2 } })).toBe(false) // reentrega
    const [d] = await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, id))
    expect(d).toMatchObject({ loteAtual: 1, loteLendoDesde: null, draftParcial: { p: 1 } })
    // próximo passo pega o lote 1 normalmente (sem retomada)
    expect(await withRole(db, 'worker_app', (tx) => proximoLote(tx, id))).toMatchObject({ loteAtual: 1, retomada: false })
    expect(await proximoLote(db, id)).toBeNull()
    // job expirado (300–420 s) com o leitor ainda vivo: a repetição não pega o lote (nem libera a reserva dele)
    await db.update(knowledgeDocuments).set({ loteLendoDesde: dsql`now() - interval '6 minutes'` }).where(eq(knowledgeDocuments.id, id))
    expect(await proximoLote(db, id)).toBeNull()
    // o leitor morreu: concessão vencida (> prazo do job) ⇒ outro retoma o mesmo lote
    await db.update(knowledgeDocuments).set({ loteLendoDesde: dsql`now() - interval '8 minutes'` }).where(eq(knowledgeDocuments.id, id))
    expect(await proximoLote(db, id)).toMatchObject({ loteAtual: 1, retomada: true })
    expect(await proximoLote(db, id)).toBeNull()
    // concluir libera a concessão
    await concluirIngestao(db, id, { ok: true, draft: { fatos: [fato('Wi-Fi')] } })
    expect((await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, id)))[0]!.loteLendoDesde).toBeNull()
  })

  it('gatilho: transições inválidas recusadas, inclusive gravar o hash e aprovar sem leitura num UPDATE só', async () => {
    const c = await cenario()
    const id = idDe(await criarImportacaoArquivos(db, as(c.dono), { alvo: 'informacoes', modo: 'completo' }))
    await anexarArquivo(db, as(c.dono), id, arq(c, 1))
    await expect(withUserContext(db, as(c.dono), (tx) => tx.update(knowledgeDocuments)
      .set({ sha256: sha(9), status: 'aprovado', draft: { fatos: [] }, revisadoPor: c.dono }).where(eq(knowledgeDocuments.id, id)))).rejects.toMatchObject(negado)
    await iniciarLeitura(db, as(c.dono), id)
    await expect(db.update(knowledgeDocuments).set({ status: 'aprovado' }).where(eq(knowledgeDocuments.id, id))).rejects.toMatchObject(negado)
    await db.update(knowledgeDocuments).set({ status: 'processando' }).where(eq(knowledgeDocuments.id, id))
    await expect(db.update(knowledgeDocuments).set({ status: 'aprovado' }).where(eq(knowledgeDocuments.id, id))).rejects.toMatchObject(negado)
    await expect(db.update(knowledgeDocuments).set({ status: 'rejeitado' }).where(eq(knowledgeDocuments.id, id))).rejects.toMatchObject(negado)
    await db.update(knowledgeDocuments).set({ status: 'erro' }).where(eq(knowledgeDocuments.id, id))
    await expect(db.update(knowledgeDocuments).set({ status: 'aprovado' }).where(eq(knowledgeDocuments.id, id))).rejects.toMatchObject(negado)
    // descartar antes de ler é permitido (enviado sem hash → rejeitado)
    const outra = idDe(await criarImportacaoArquivos(db, as(c.dono), { alvo: 'espacos', modo: 'completo' }))
    await db.update(knowledgeDocuments).set({ status: 'rejeitado' }).where(eq(knowledgeDocuments.id, outra))
  })

  it('aplicar: ja_aplicado só na aprovada; enviado/processando/erro/rejeitada ⇒ nao_pronta', async () => {
    const c = await cenario()
    const r = { fatos: [fato('Wi-Fi')] }
    const id = idDe(await criarImportacaoArquivos(db, as(c.dono), { alvo: 'informacoes', modo: 'completo' }))
    expect(await aplicarImportacao(db, as(c.dono), id, r)).toEqual({ ok: false, erro: 'nao_pronta' })
    await anexarArquivo(db, as(c.dono), id, arq(c, 1))
    await iniciarLeitura(db, as(c.dono), id)
    expect(await aplicarImportacao(db, as(c.dono), id, r)).toEqual({ ok: false, erro: 'nao_pronta' })
    await proximoLote(db, id)
    expect(await aplicarImportacao(db, as(c.dono), id, r)).toEqual({ ok: false, erro: 'nao_pronta' })
    await concluirIngestao(db, id, { ok: false, erro: 'falhou' })
    expect(await aplicarImportacao(db, as(c.dono), id, r)).toEqual({ ok: false, erro: 'nao_pronta' })
    await rejeitarImportacao(db, as(c.dono), id)
    expect(await aplicarImportacao(db, as(c.dono), id, r)).toEqual({ ok: false, erro: 'nao_pronta' })
    const ok2 = await comRascunho(c, 'informacoes', r, 'completo', 2)
    expect((await aplicarImportacao(db, as(c.dono), ok2, r)).ok).toBe(true)
    expect(await aplicarImportacao(db, as(c.dono), ok2, r)).toEqual({ ok: false, erro: 'ja_aplicado' })
  })

  it('tema/nome repetido no rascunho: um cadastro só, e a soma das contagens fecha com as linhas', async () => {
    const c = await cenario()
    const r: RascunhoInformacoes = { fatos: [fato('Wi-Fi', { texto: 'Primeiro' }), fato('wi fi', { texto: 'Segundo' }), fato('Pets')] }
    const id = await comRascunho(c, 'informacoes', r)
    expect(await aplicarImportacao(db, as(c.dono), id, r)).toEqual({ ok: true, valor: { criados: 2, atualizados: 1, ignorados: 0 } })
    const fs = await db.select().from(knowledgeFacts)
    expect(fs.map((f) => f.texto).sort()).toEqual(['Segundo', 'Texto de Pets'])
    const e: RascunhoEspacos = { espacos: [
      { nome: 'Varanda', capacidadeMin: 1, capacidadeMax: 10, descricao: null, condicoes: null, unidade: 'Asa Sul', incluir: true },
      { nome: 'VARANDA', capacidadeMin: 2, capacidadeMax: 20, descricao: null, condicoes: null, unidade: 'Asa Sul', incluir: true },
    ] }
    const id2 = await comRascunho(c, 'espacos', e, 'completo', 2)
    expect(await aplicarImportacao(db, as(c.dono), id2, e)).toEqual({ ok: true, valor: { criados: 1, atualizados: 1, ignorados: 0 } })
    expect(await db.select().from(eventSpaces)).toEqual([expect.objectContaining({ nome: 'Varanda', capacidadeMin: 2, capacidadeMax: 20 })])
  })

  it('unidade: id, slug e nome exato vencem o apelido de outra unidade (escolha na revisão nunca fica ambígua)', async () => {
    const c = await cenario()
    // "Centro" é o nome de uma unidade e apelido de outra
    const [centro] = await db.insert(units).values({ restaurantId: c.restaurantId, nome: 'Centro', slug: 'centro-novo' }).returning()
    await db.update(units).set({ apelidos: ['centro'] }).where(eq(units.id, c.u1))
    const h = (unidade: string) => ({ unidade, semana: [{ dia: 1, turnos: [{ abre: '10:00', fecha: '14:00' }], conflito: false }], excecoes: [], incluir: true })
    const r: RascunhoHorarios = { unidades: [h('Centro'), h('asa-norte'), h(c.u1)] }
    const id = await comRascunho(c, 'horarios', r)
    const rev = await revisaoImportacao(db, as(c.dono), id)
    expect(rev!.alvo === 'horarios' && rev!.unidades.map((u) => u.unitId)).toEqual([centro!.id, c.u2, c.u1])
    expect((await aplicarImportacao(db, as(c.dono), id, r)).ok).toBe(true)
    expect(await db.select().from(unitHours).where(eq(unitHours.unitId, centro!.id))).toHaveLength(1)
  })

  it('gerente restrito não vê a revisão', async () => {
    const c = await cenario()
    const id = await comRascunho(c, 'informacoes', { fatos: [fato('Wi-Fi')] })
    expect(await revisaoImportacao(db, as(c.gerenteU1), id)).toBeNull()
    expect(await revisaoImportacao(db, as(c.gerente), id)).not.toBeNull()
  })

  it('migração 0040 sobre dados existentes: a recriação do enum preserva as importações da Etapa 05 e o default', async () => {
    // Reaplica, numa tabela de ensaio com o formato de antes (enum só com cardapio, default 'cardapio'), exatamente as
    // instruções de recriação do enum da 0040 (lidas do arquivo, com os nomes trocados para os de ensaio).
    const texto = readFileSync(fileURLToPath(new URL('../migrations/0040_importacao_alvos.sql', import.meta.url)), 'utf8')
    const instrucoes = texto.split('--> statement-breakpoint').map((x) => x.replace(/^\s*--.*$/gm, '').trim())
      .filter((x) => /knowledge_document_target|ALTER COLUMN "alvo"/.test(x))
    expect(instrucoes).toHaveLength(6)
    const ensaio = (x: string) => x
      .replaceAll('"public"."knowledge_document_target_v2"', '"public"."ens_target_v2"')
      .replaceAll('"knowledge_document_target_v2"', '"ens_target_v2"')
      .replaceAll('"public"."knowledge_document_target"', '"public"."ens_target"')
      .replaceAll('"knowledge_document_target"', '"ens_target"')
      .replaceAll('"public"."knowledge_documents"', '"public"."ens_docs"')
    await sql.begin(async (tx) => {
      await tx.unsafe(`create type public.ens_target as enum ('cardapio');
        create table public.ens_docs (id serial primary key, alvo public.ens_target not null default 'cardapio', origem text not null);
        insert into public.ens_docs (origem) values ('csv'), ('arquivo');`)
      for (const i of instrucoes) await tx.unsafe(ensaio(i))
      const linhas = await tx.unsafe(`select alvo::text as alvo, origem from public.ens_docs order by id`)
      expect(linhas.map((l) => [l.alvo, l.origem])).toEqual([['cardapio', 'csv'], ['cardapio', 'arquivo']])
      await tx.unsafe(`insert into public.ens_docs (origem, alvo) values ('arquivo', 'horarios'); insert into public.ens_docs (origem) values ('x')`)
      const [{ n }] = await tx.unsafe(`select count(*)::int as n from public.ens_docs where alvo = 'cardapio'`) as unknown as [{ n: number }]
      expect(n).toBe(3)
      await tx.unsafe('drop table public.ens_docs; drop type public.ens_target')
    })
    // e as linhas da Etapa 05 (CSV e um arquivo) cabem no check novo
    const c = await cenario()
    await db.insert(knowledgeDocuments).values([
      { restaurantId: c.restaurantId, origem: 'csv', status: 'rascunho', mime: 'text/csv', tamanho: 1, sha256: sha(1), draft: { categorias: [] } },
      { restaurantId: c.restaurantId, origem: 'arquivo', status: 'enviado', storagePath: caminho(c, 'm.pdf'), mime: 'application/pdf', tamanho: 9, sha256: sha(2) },
    ])
    expect((await db.select().from(knowledgeDocuments)).map((d) => [d.alvo, d.modo, d.loteAtual])).toEqual([['cardapio', 'completo', 0], ['cardapio', 'completo', 0]])
  })
})
