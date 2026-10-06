import { createHash } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { PDFDocument } from 'pdf-lib'
import { createDb, reserveBudget, schema } from '@atd/db'
import { getTestDb, resetDb, seedRestaurant, setupPgbossRoles, WORKER_URL } from '@atd/db/test-utils'
import { parseLeituraCardapio, type ConteudoUsuario, type LlmClient } from '@atd/ai'
import { createLogger } from '../logger.ts'
import { ingestDocument, type IngestDeps } from './ingest-document.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const log = createLogger(process.env.DBG ? 'debug' : 'silent')
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
/** PNG "diferente" por número (o sha256 de cada arquivo da importação é único) */
const png = (n: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, n])
async function pdfDePaginas(n: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < n; i++) doc.addPage([100 + i, 100])
  return doc.save()
}

type Arquivo = { bytes: Uint8Array; mime: string; paginas?: number | null; sha256?: string }

async function setup(o: {
  arquivos: Arquivo[]
  alvo?: 'cardapio' | 'informacoes' | 'horarios' | 'espacos'
  modo?: 'completo' | 'so_precos'
  limiteDia?: string
}) {
  const { restaurantId } = await seedRestaurant(db)
  await db.insert(schema.budgetLimits).values([
    { restaurantId, escopo: 'ia', periodo: 'dia', limiteUsd: o.limiteDia ?? '5' },
    { restaurantId, escopo: 'ia', periodo: 'mes', limiteUsd: '50' },
  ])
  const [d] = await db.insert(schema.knowledgeDocuments).values({
    restaurantId, alvo: o.alvo ?? 'cardapio', modo: o.modo ?? 'completo', origem: 'arquivo', status: 'enviado',
    sha256: sha(new TextEncoder().encode(String(Math.random()))),
  }).returning()
  const objetos = new Map<string, Uint8Array>()
  await db.insert(schema.knowledgeDocumentFiles).values(o.arquivos.map((a, i) => {
    const caminho = `${restaurantId}/arquivo-${i + 1}`
    objetos.set(caminho, a.bytes)
    return {
      restaurantId, importacaoId: d!.id, ordem: i + 1, storagePath: `importacoes/${caminho}`, mime: a.mime,
      tamanho: a.bytes.length, sha256: a.sha256 ?? sha(a.bytes), paginas: a.paginas ?? null,
    }
  }))
  return { restaurantId, id: d!.id, objetos }
}

type Resposta = unknown | 'truncada' | 'invalida'
function fakeLlm(respostas: Resposta[] | ((i: number) => Resposta)) {
  const chamadas: { partes: ConteudoUsuario[]; schemaName: string; user: string }[] = []
  const llm: LlmClient = {
    async completeJson(p) {
      const i = chamadas.length
      chamadas.push({ partes: p.userParts ?? [], schemaName: p.schemaName, user: p.user })
      const r = typeof respostas === 'function' ? respostas(i) : respostas[i]
      const usage = { tokensIn: 3000, tokensOut: 400, tokensCache: 0, costUsd: '0.004000' }
      if (r === 'truncada') return { ok: false as const, error: 'saida_truncada', retryable: false, status: 200, model: 'visao/m', usage, latencyMs: 900 }
      if (r === 'invalida') return { ok: false as const, error: 'saida_invalida', retryable: true, status: 200, model: 'visao/m', usage, latencyMs: 900 }
      return { ok: true as const, data: p.parse(r), model: 'visao/m', usage, latencyMs: 900 }
    },
  }
  return { llm, chamadas }
}

function fakeStorage(objetos: Map<string, Uint8Array>) {
  const baixados: string[] = []
  return {
    baixados,
    async baixarObjeto(bucket: string, caminho: string) {
      baixados.push(`${bucket}/${caminho}`)
      const b = objetos.get(caminho)
      if (!b) throw new Error('404')
      return b
    },
  }
}

function deps(llm: LlmClient, objetos: Map<string, Uint8Array>, o: Partial<IngestDeps> = {}) {
  const passos: string[] = []
  const storage = fakeStorage(objetos)
  const d: IngestDeps = {
    db, llm, storage, ingestModels: ['visao/m'], log,
    reenfileirar: async (_id, passo) => { passos.push(passo) },
    ...o,
  }
  return { d, passos, storage }
}

const importacao = async (id: string) => (await db.select().from(schema.knowledgeDocuments).where(eq(schema.knowledgeDocuments.id, id)))[0]!
const contadores = (restaurantId: string) =>
  db.select({ periodo: schema.budgetCounters.periodo, reservado: schema.budgetCounters.reservado, gasto: schema.budgetCounters.gasto })
    .from(schema.budgetCounters).where(eq(schema.budgetCounters.restaurantId, restaurantId)).orderBy(schema.budgetCounters.periodo)
const runs = () => db.select().from(schema.aiRuns)
const cardapio = (itens: [string, number | null][]) => ({
  categorias: [{ nome: 'Pratos', itens: itens.map(([nome, preco]) => ({ nome, descricao: null, precoCentavos: preco, tags: [], unidade: null })) }],
})
const paginasDoPdf = async (p: ConteudoUsuario) => {
  if (p.type !== 'pdf') throw new Error('não é PDF')
  const doc = await PDFDocument.load(Buffer.from(p.base64, 'base64'))
  return doc.getPages().map((pg) => pg.getWidth() - 99) // larguras 100.. ⇒ páginas 1..
}
/** roda o job até não haver próximo passo (simula a fila) */
async function rodarAte(d: IngestDeps, passos: string[], id: string, max = 20) {
  const saidas: string[] = []
  for (let i = 0; i < max; i++) {
    const antes = passos.length
    const s = await ingestDocument(d, id)
    saidas.push(s)
    if (passos.length === antes) break
  }
  return saidas
}

describe('job document.ingest — importação em lotes (Etapa 07)', () => {
  it('várias fotos de cardápio (7 = 3 lotes): um lote por execução, reenfileira com o passo, junta num rascunho só', async () => {
    const { restaurantId, id, objetos } = await setup({ arquivos: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ bytes: png(n), mime: 'image/png' })) })
    const { llm, chamadas } = fakeLlm([
      cardapio([['Picanha', 8990], ['Arroz', 1500]]),
      // o mesmo prato noutra foto com preço diferente: um item com conflito (Review Focus 2)
      cardapio([['Picanha', 9490], ['Feijão', null]]),
      cardapio([['Feijão', 1200]]),
    ])
    const { d, passos } = deps(llm, objetos)

    expect(await ingestDocument(d, id)).toBe('lote')
    expect(passos).toEqual(['1'])
    expect(chamadas[0]!.partes.map((p) => p.type)).toEqual(['image', 'image', 'image'])
    expect(chamadas[0]!.schemaName).toBe('rascunho_cardapio')
    expect(await importacao(id)).toMatchObject({ status: 'processando', loteAtual: 1, lotesTotal: 3 })

    expect(await ingestDocument(d, id)).toBe('lote')
    expect(await ingestDocument(d, id)).toBe('rascunho')
    expect(passos).toEqual(['1', '2'])
    expect(chamadas.map((c) => c.partes.length)).toEqual([3, 3, 1])
    const doc = await importacao(id)
    expect(doc).toMatchObject({ status: 'rascunho', erro: null, draftParcial: null, loteAtual: 3, lotesTotal: 3 })
    const itens = (doc.draft as { categorias: { itens: { nome: string; precoCentavos: number | null; precoConflito?: number[] }[] }[] }).categorias[0]!.itens
    expect(itens.map((i) => [i.nome, i.precoCentavos, i.precoConflito ?? null])).toEqual([
      ['Picanha', 8990, [8990, 9490]], ['Arroz', 1500, null], ['Feijão', 1200, null],
    ])
    // um ai_runs e uma reserva liquidada por lote; nada vira dado oficial
    expect((await runs()).map((r) => [r.etapa, r.intent, r.promptVersion, r.resultado])).toEqual(Array(3).fill(['ingestao', 'cardapio', 'ingestao-cardapio-v1', 'ok']))
    expect((await contadores(restaurantId)).map((c) => [c.reservado, c.gasto])).toEqual([['0.000000', '0.012000'], ['0.000000', '0.012000']])
    expect(await db.select().from(schema.menuItems)).toEqual([])
    // ainda processando ou já em rascunho: outra execução não faz nada
    expect(await ingestDocument(d, id)).toBe('ignorado')
    expect(chamadas).toHaveLength(3)
  })

  it('PDF de 12 páginas: o primeiro passo só conta as páginas (sem IA); depois 3 lotes de até 5 páginas', async () => {
    const pdf = await pdfDePaginas(12)
    const { restaurantId, id, objetos } = await setup({ arquivos: [{ bytes: pdf, mime: 'application/pdf' }], alvo: 'informacoes' })
    const fatos = (tema: string) => ({ fatos: [{ tema, texto: `Sobre ${tema}.`, exemplos: [], unidade: null }] })
    const { llm, chamadas } = fakeLlm([fatos('Wi-Fi'), fatos('Pets'), fatos('Estacionamento')])
    const { d, passos } = deps(llm, objetos)

    expect(await ingestDocument(d, id)).toBe('lote')
    expect(chamadas).toHaveLength(0)
    expect(passos).toEqual(['0'])
    expect(await importacao(id)).toMatchObject({ status: 'processando', loteAtual: 0, lotesTotal: 3 })
    const [arq] = await db.select().from(schema.knowledgeDocumentFiles)
    expect(arq!.paginas).toBe(12)
    expect(await contadores(restaurantId)).toEqual([])

    expect(await rodarAte(d, passos, id)).toEqual(['lote', 'lote', 'rascunho'])
    expect(passos).toEqual(['0', '1', '2'])
    expect(await Promise.all(chamadas.map((c) => paginasDoPdf(c.partes[0]!)))).toEqual([[1, 2, 3, 4, 5], [6, 7, 8, 9, 10], [11, 12]])
    expect(chamadas[0]!.schemaName).toBe('rascunho_informacoes')
    expect(chamadas[0]!.user).toMatch(/^Hoje é \d{4}-\d{2}-\d{2}\./)
    const doc = await importacao(id)
    expect(doc.status).toBe('rascunho')
    expect((doc.draft as { fatos: { tema: string }[] }).fatos.map((f) => f.tema)).toEqual(['Wi-Fi', 'Pets', 'Estacionamento'])
    expect((await runs()).map((r) => [r.intent, r.promptVersion])).toEqual(Array(3).fill(['informacoes', 'ingestao-informacoes-v1']))
  })

  it('worker caiu no lote 4 de 7: retoma no 4 sem reler 1–3 nem cobrar de novo; a reserva do processo morto volta (Review Focus 3)', async () => {
    const pdf = await pdfDePaginas(35)
    const { restaurantId, id, objetos } = await setup({ arquivos: [{ bytes: pdf, mime: 'application/pdf', paginas: 35 }] })
    const parcial = { rascunho: parseLeituraCardapio(cardapio([['Picanha', 8990]])), metade: null }
    await db.update(schema.knowledgeDocuments).set({ status: 'processando', loteAtual: 3, lotesTotal: 7, draftParcial: parcial })
      .where(eq(schema.knowledgeDocuments.id, id))
    await reserveBudget(db, { restaurantId, scope: 'ia', amountUsd: '0.50', timeZone: 'America/Sao_Paulo', ref: `importacao:${id}` })
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`
      await tx`update knowledge_documents set updated_at = now() - interval '6 minutes' where id = ${id}`
    })
    const { llm, chamadas } = fakeLlm(() => cardapio([['Arroz', 1500]]))
    const { d, passos } = deps(llm, objetos)

    expect(await ingestDocument(d, id)).toBe('lote')
    expect(chamadas).toHaveLength(1)
    expect(await paginasDoPdf(chamadas[0]!.partes[0]!)).toEqual([16, 17, 18, 19, 20])
    expect(passos).toEqual(['4'])
    const doc = await importacao(id)
    expect(doc).toMatchObject({ status: 'processando', loteAtual: 4, lotesTotal: 7 })
    expect((doc.draftParcial as { rascunho: { categorias: { itens: { nome: string }[] }[] } }).rascunho.categorias[0]!.itens.map((i) => i.nome))
      .toEqual(['Picanha', 'Arroz'])
    // reserva do morto devolvida; só o lote 4 foi cobrado
    expect((await contadores(restaurantId)).map((c) => [c.reservado, c.gasto])).toEqual([['0.000000', '0.004000'], ['0.000000', '0.004000']])
    expect(await runs()).toHaveLength(1)
  })

  it('saída cortada num lote de PDF: divide ao meio uma vez (cada metade numa execução) e segue', async () => {
    const pdf = await pdfDePaginas(5)
    const { restaurantId, id, objetos } = await setup({ arquivos: [{ bytes: pdf, mime: 'application/pdf', paginas: 5 }] })
    const { llm, chamadas } = fakeLlm(['truncada', cardapio([['Picanha', 8990]]), cardapio([['Arroz', 1500]])])
    const { d, passos } = deps(llm, objetos)

    expect(await rodarAte(d, passos, id)).toEqual(['lote', 'lote', 'rascunho'])
    expect(passos).toEqual(['0a', '0b'])
    // inteiro (PDF original), depois páginas 1–3 e 4–5
    expect(chamadas[0]!.partes[0]).toMatchObject({ type: 'pdf', filename: 'documento-1.pdf' })
    expect(await paginasDoPdf(chamadas[1]!.partes[0]!)).toEqual([1, 2, 3])
    expect(await paginasDoPdf(chamadas[2]!.partes[0]!)).toEqual([4, 5])
    const doc = await importacao(id)
    expect(doc.status).toBe('rascunho')
    expect((doc.draft as { categorias: { itens: { nome: string }[] }[] }).categorias[0]!.itens.map((i) => i.nome)).toEqual(['Picanha', 'Arroz'])
    expect((await runs()).map((r) => r.erro)).toEqual(['saida_truncada', null, null])
    expect((await contadores(restaurantId)).map((c) => c.gasto)).toEqual(['0.012000', '0.012000'])
  })

  it('metade ainda cortada: erro "grande demais" (não divide de novo), o parcial fica', async () => {
    const pdf = await pdfDePaginas(10)
    const { id, objetos } = await setup({ arquivos: [{ bytes: pdf, mime: 'application/pdf', paginas: 10 }] })
    const { llm, chamadas } = fakeLlm([cardapio([['Picanha', 8990]]), 'truncada', 'truncada'])
    const { d, passos } = deps(llm, objetos)

    expect(await rodarAte(d, passos, id)).toEqual(['lote', 'lote', 'erro'])
    expect(chamadas).toHaveLength(3)
    const doc = await importacao(id)
    expect(doc).toMatchObject({ status: 'erro', draft: null, loteAtual: 1 })
    expect(doc.erro).toMatch(/grande demais/i)
    expect(doc.draftParcial).toMatchObject({ rascunho: { categorias: [{ itens: [{ nome: 'Picanha' }] }] } })
  })

  it('imagem única com saída cortada: erro amigável sem dividir', async () => {
    const { id, objetos } = await setup({ arquivos: [{ bytes: png(1), mime: 'image/png' }] })
    const { llm, chamadas } = fakeLlm(['truncada'])
    const { d, passos } = deps(llm, objetos)
    expect(await ingestDocument(d, id)).toBe('erro')
    expect(chamadas).toHaveLength(1)
    expect(passos).toEqual([])
    expect((await importacao(id)).erro).toMatch(/grande demais/i)
  })

  it('sem AI_INGEST_MODELS: erro de configuração, sem baixar, reservar nem chamar a IA', async () => {
    const { restaurantId, id, objetos } = await setup({ arquivos: [{ bytes: png(1), mime: 'image/png' }] })
    const { llm, chamadas } = fakeLlm([])
    const { d, storage } = deps(llm, objetos, { ingestModels: undefined })
    expect(await ingestDocument(d, id)).toBe('erro')
    expect(chamadas).toHaveLength(0)
    expect(storage.baixados).toEqual([])
    expect((await importacao(id)).erro).toBe('Importação por IA não configurada. Envie um CSV.')
    expect(await contadores(restaurantId)).toEqual([])
  })

  it('sem saldo no lote 2: para com erro de limite, sem chamar a IA, e mantém o parcial do lote 1', async () => {
    const { restaurantId, id, objetos } = await setup({ arquivos: [1, 2, 3, 4].map((n) => ({ bytes: png(n), mime: 'image/png' })) })
    const { llm, chamadas } = fakeLlm([cardapio([['Picanha', 8990]])])
    const { d, passos } = deps(llm, objetos)
    expect(await ingestDocument(d, id)).toBe('lote')
    await db.update(schema.budgetLimits).set({ limiteUsd: '0.10' }).where(eq(schema.budgetLimits.restaurantId, restaurantId))

    expect(await ingestDocument(d, id)).toBe('erro')
    expect(chamadas).toHaveLength(1)
    expect(passos).toEqual(['1'])
    const doc = await importacao(id)
    expect(doc).toMatchObject({ status: 'erro', loteAtual: 1, lotesTotal: 2 })
    expect(doc.erro).toMatch(/limite de gastos/i)
    expect(doc.draftParcial).toMatchObject({ rascunho: { categorias: [{ itens: [{ nome: 'Picanha' }] }] } })
    const [audit] = await db.select().from(schema.auditLog).where(eq(schema.auditLog.acao, 'orcamento.sem_saldo'))
    expect(audit).toMatchObject({ entidadeId: id, atorTipo: 'ia' })
  })

  it('arquivo do lote com sha256 diferente do gravado (ou tipo errado): erro, sem IA, reserva devolvida', async () => {
    const { restaurantId, id, objetos } = await setup({ arquivos: [{ bytes: png(1), mime: 'image/png', sha256: 'f'.repeat(64) }] })
    const { llm, chamadas } = fakeLlm([])
    expect(await ingestDocument(deps(llm, objetos).d, id)).toBe('erro')
    expect(chamadas).toHaveLength(0)
    expect((await importacao(id)).erro).toBe('O arquivo no armazenamento não confere com o enviado. Envie de novo.')
    expect((await contadores(restaurantId)).map((c) => c.reservado)).toEqual(['0.000000', '0.000000'])

    const outro = await setup({ arquivos: [{ bytes: new TextEncoder().encode('<html>'), mime: 'image/png' }] })
    expect(await ingestDocument(deps(llm, outro.objetos).d, outro.id)).toBe('erro')
    expect((await importacao(outro.id)).erro).toBe('O arquivo enviado não é um PDF nem uma imagem válida. Envie de novo.')
  })

  it('PDF que não abre no primeiro passo: erro amigável, sem IA', async () => {
    const ruim = new TextEncoder().encode('%PDF-1.7 corrompido')
    const { id, objetos } = await setup({ arquivos: [{ bytes: ruim, mime: 'application/pdf' }] })
    const { llm, chamadas } = fakeLlm([])
    expect(await ingestDocument(deps(llm, objetos).d, id)).toBe('erro')
    expect(chamadas).toHaveLength(0)
    expect((await importacao(id)).erro).toBe('Não consegui abrir um dos PDFs enviados. Envie de novo ou use fotos.')
  })

  it('falha ao reenfileirar depois de salvar o lote: lança (o pg-boss repete o job, que segue do lote seguinte)', async () => {
    const { id, objetos } = await setup({ arquivos: [1, 2, 3, 4].map((n) => ({ bytes: png(n), mime: 'image/png' })) })
    const { llm, chamadas } = fakeLlm([cardapio([['Picanha', 8990]]), cardapio([['Arroz', 1500]])])
    const { d } = deps(llm, objetos, { reenfileirar: async () => { throw new Error('fila fora') } })
    await expect(ingestDocument(d, id)).rejects.toThrow('fila fora')
    expect(await importacao(id)).toMatchObject({ status: 'processando', loteAtual: 1 })
    // a repetição do job lê o lote 2, sem reler o 1
    expect(await ingestDocument({ ...d, reenfileirar: async () => undefined }, id)).toBe('rascunho')
    expect(chamadas).toHaveLength(2)
  })

  it('último lote sem nada do alvo em nenhum lote: erro de vazio do alvo', async () => {
    const { id, objetos } = await setup({ arquivos: [{ bytes: png(1), mime: 'image/png' }], alvo: 'espacos' })
    const { llm } = fakeLlm([{ espacos: [] }])
    expect(await ingestDocument(deps(llm, objetos).d, id)).toBe('erro')
    expect((await importacao(id)).status).toBe('erro')
  })

  describe('com o role de produção (worker_app)', () => {
    let worker: ReturnType<typeof createDb>
    beforeAll(async () => {
      await setupPgbossRoles()
      worker = createDb(WORKER_URL, { max: 2 })
    })
    afterAll(() => worker.sql.end())

    it('conta páginas, salva lotes, divide lote cortado e conclui só com os grants do worker', async () => {
      const pdf = await pdfDePaginas(7)
      const { id, objetos } = await setup({ arquivos: [{ bytes: pdf, mime: 'application/pdf' }, { bytes: png(1), mime: 'image/png' }] })
      const { llm } = fakeLlm(['truncada', cardapio([['Picanha', 8990]]), cardapio([['Arroz', 1500]]), cardapio([['Feijão', 1200]]), cardapio([['Suco', 900]])])
      const { d, passos } = deps(llm, objetos, { db: worker.db })
      expect(await rodarAte(d, passos, id)).toEqual(['lote', 'lote', 'lote', 'lote', 'lote', 'rascunho'])
      expect(passos).toEqual(['0', '0a', '0b', '1', '2'])
      const doc = await importacao(id)
      expect(doc).toMatchObject({ status: 'rascunho', loteAtual: 3, lotesTotal: 3, draftParcial: null })
    })
  })
})
