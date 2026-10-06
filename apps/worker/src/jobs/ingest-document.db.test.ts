import { createHash } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { reserveBudget, schema } from '@atd/db'
import { getTestDb, resetDb, seedRestaurant } from '@atd/db/test-utils'
import type { LlmClient } from '@atd/ai'
import { createLogger } from '../logger.ts'
import { ingestDocument, type IngestDeps } from './ingest-document.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const log = createLogger('silent')
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])
const SHA_PDF = createHash('sha256').update(PDF).digest('hex')
const LEITURA = {
  categorias: [{ nome: 'Carnes', itens: [{ nome: 'Picanha', descricao: null, precoCentavos: 8990, tags: [], unidade: null }] }],
}

async function setup(o: { status?: 'enviado' | 'rascunho'; limiteDia?: string; mime?: string; sha256?: string } = {}) {
  const { restaurantId } = await seedRestaurant(db)
  await db.insert(schema.budgetLimits).values([
    { restaurantId, escopo: 'ia', periodo: 'dia', limiteUsd: o.limiteDia ?? '1' },
    { restaurantId, escopo: 'ia', periodo: 'mes', limiteUsd: '10' },
  ])
  const [d] = await db.insert(schema.knowledgeDocuments).values({
    restaurantId, origem: 'arquivo', status: o.status ?? 'enviado', storagePath: `importacoes/${restaurantId}/menu.pdf`,
    mime: o.mime ?? 'application/pdf', tamanho: PDF.length, sha256: o.sha256 ?? SHA_PDF,
  }).returning()
  return { restaurantId, id: d!.id }
}

function fakeLlm(resposta: unknown | 'invalida' | 'truncada') {
  const chamadas: { models: string[]; userParts: unknown; schemaName: string }[] = []
  const llm: LlmClient = {
    async completeJson(p) {
      chamadas.push({ models: p.models, userParts: p.userParts, schemaName: p.schemaName })
      const usage = { tokensIn: 3000, tokensOut: 400, tokensCache: 0, costUsd: '0.004000' }
      if (resposta === 'truncada') {
        return { ok: false as const, error: 'saida_truncada', retryable: false, status: 200, model: 'visao/m', usage, latencyMs: 900 }
      }
      if (resposta === 'invalida') {
        return { ok: false as const, error: 'saida_invalida', retryable: true, status: 200, model: 'visao/m', usage, latencyMs: 900 }
      }
      return { ok: true as const, data: p.parse(resposta), model: 'visao/m', usage, latencyMs: 900 }
    },
  }
  return { llm, chamadas }
}

function fakeStorage() {
  const baixados: { bucket: string; caminho: string }[] = []
  return {
    baixados,
    async baixarObjeto(bucket: string, caminho: string) {
      baixados.push({ bucket, caminho })
      return PDF
    },
  }
}

const deps = (llm: LlmClient, o: Partial<IngestDeps> = {}): IngestDeps =>
  ({ db, llm, storage: fakeStorage(), ingestModels: ['visao/m'], log, ...o })
const importacao = async (id: string) => (await db.select().from(schema.knowledgeDocuments).where(eq(schema.knowledgeDocuments.id, id)))[0]!
const contadores = (restaurantId: string) =>
  db.select({ reservado: schema.budgetCounters.reservado, gasto: schema.budgetCounters.gasto }).from(schema.budgetCounters)
    .where(eq(schema.budgetCounters.restaurantId, restaurantId))

describe('job document.ingest', () => {
  it('sucesso: baixa do bucket importacoes, lê pela IA, grava o rascunho (nunca dado oficial), liquida e registra ai_runs', async () => {
    const { restaurantId, id } = await setup()
    const { llm, chamadas } = fakeLlm(LEITURA)
    const storage = fakeStorage()
    expect(await ingestDocument(deps(llm, { storage }), id)).toBe('rascunho')
    expect(storage.baixados).toEqual([{ bucket: 'importacoes', caminho: `${restaurantId}/menu.pdf` }])
    expect(chamadas).toHaveLength(1)
    expect(chamadas[0]!.models).toEqual(['visao/m'])
    expect(chamadas[0]!.userParts).toEqual([{ type: 'pdf', filename: 'menu.pdf', base64: Buffer.from(PDF).toString('base64') }])
    const d = await importacao(id)
    expect(d.status).toBe('rascunho')
    expect(d.erro).toBeNull()
    expect(d.draft).toMatchObject({ categorias: [{ nome: 'Carnes', itens: [{ nome: 'Picanha', precoCentavos: 8990, incluir: true }] }] })
    // documento nunca vira dado oficial sem aprovação humana
    expect(await db.select().from(schema.menuItems)).toEqual([])
    const [run] = await db.select().from(schema.aiRuns)
    expect(run).toMatchObject({
      restaurantId, conversationId: null, etapa: 'ingestao', modelo: 'visao/m', promptVersion: 'ingestao-cardapio-v1',
      tokensIn: 3000, tokensOut: 400, costUsd: '0.004000', resultado: 'ok', simulado: false,
    })
    expect((await contadores(restaurantId)).map((c) => [c.reservado, c.gasto])).toEqual([['0.000000', '0.004000'], ['0.000000', '0.004000']])
  })

  it('IA devolve saída inválida (2×): erro amigável, custo das duas chamadas liquidado', async () => {
    const { restaurantId, id } = await setup()
    const { llm, chamadas } = fakeLlm('invalida')
    expect(await ingestDocument(deps(llm), id)).toBe('erro')
    expect(chamadas).toHaveLength(2)
    const d = await importacao(id)
    expect(d).toMatchObject({ status: 'erro', draft: null, erro: 'Não consegui ler esse arquivo. Tente uma foto mais nítida ou envie um CSV.' })
    const runs = await db.select().from(schema.aiRuns)
    expect(runs.map((r) => [r.etapa, r.resultado, r.erro])).toEqual([['ingestao', 'erro', 'saida_invalida'], ['ingestao', 'erro', 'saida_invalida']])
    expect((await contadores(restaurantId)).map((c) => c.gasto)).toEqual(['0.008000', '0.008000'])
  })

  it('saída cortada (cardápio grande demais): uma chamada só, custo liquidado, pede o cardápio em partes (I3)', async () => {
    const { restaurantId, id } = await setup()
    const { llm, chamadas } = fakeLlm('truncada')
    expect(await ingestDocument(deps(llm), id)).toBe('erro')
    expect(chamadas).toHaveLength(1)
    expect(await importacao(id)).toMatchObject({
      status: 'erro', draft: null, erro: 'Cardápio grande demais para ler de uma vez: envie em partes (PDF menor ou fotos) ou use o CSV.',
    })
    expect((await db.select().from(schema.aiRuns)).map((r) => r.erro)).toEqual(['saida_truncada'])
    expect((await contadores(restaurantId)).map((c) => [c.reservado, c.gasto])).toEqual([['0.000000', '0.004000'], ['0.000000', '0.004000']])
  })

  it('arquivo sem itens de cardápio: erro "Não encontrei itens…", custo liquidado, nada de rascunho vazio (M2)', async () => {
    const { restaurantId, id } = await setup()
    const { llm } = fakeLlm({ categorias: [{ nome: 'Aviso', itens: [] }] })
    expect(await ingestDocument(deps(llm), id)).toBe('erro')
    expect(await importacao(id)).toMatchObject({ status: 'erro', draft: null, erro: 'Não encontrei itens de cardápio nesse arquivo.' })
    const [log] = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entidadeId, id))
    expect(log!.acao).toBe('cardapio.importacao_erro')
    expect((await contadores(restaurantId)).map((c) => [c.reservado, c.gasto])).toEqual([['0.000000', '0.004000'], ['0.000000', '0.004000']])
  })

  it('conteúdo baixado com sha256 diferente do gravado: erro, sem chamar a IA, reserva devolvida (M8)', async () => {
    const { restaurantId, id } = await setup({ sha256: 'f'.repeat(64) })
    const { llm, chamadas } = fakeLlm(LEITURA)
    expect(await ingestDocument(deps(llm), id)).toBe('erro')
    expect(chamadas).toHaveLength(0)
    expect((await importacao(id)).erro).toBe('O arquivo no armazenamento não confere com o enviado. Envie de novo.')
    expect((await contadores(restaurantId)).map((c) => c.reservado)).toEqual(['0.000000', '0.000000'])
  })

  it('exceção inesperada na leitura: a importação vai a erro (nunca fica presa em "processando") e a reserva é devolvida', async () => {
    const { restaurantId, id } = await setup()
    const llm: LlmClient = { async completeJson() { throw new Error('bug') } }
    expect(await ingestDocument(deps(llm), id)).toBe('erro')
    expect(await importacao(id)).toMatchObject({ status: 'erro', erro: 'Não foi possível ler o arquivo agora. Envie de novo.' })
    expect((await contadores(restaurantId)).map((c) => c.reservado)).toEqual(['0.000000', '0.000000'])
  })

  it('sem orçamento de IA: erro "limite de gastos", sem chamar a IA nem baixar o arquivo', async () => {
    const { id } = await setup({ limiteDia: '0.20' })
    const { llm, chamadas } = fakeLlm(LEITURA)
    const storage = fakeStorage()
    expect(await ingestDocument(deps(llm, { storage }), id)).toBe('erro')
    expect(chamadas).toHaveLength(0)
    expect(storage.baixados).toEqual([])
    expect((await importacao(id)).erro).toMatch(/limite de gastos/i)
  })

  it('sem AI_INGEST_MODELS: erro de configuração, sem reservar nem chamar a IA', async () => {
    const { restaurantId, id } = await setup()
    const { llm, chamadas } = fakeLlm(LEITURA)
    expect(await ingestDocument(deps(llm, { ingestModels: undefined }), id)).toBe('erro')
    expect(chamadas).toHaveLength(0)
    expect((await importacao(id)).erro).toBe('Importação por IA não configurada. Envie um CSV.')
    expect(await contadores(restaurantId)).toEqual([])
  })

  it('só processa importação "enviado" (rascunho, repetida ou inexistente: nada muda)', async () => {
    const { id } = await setup({ status: 'rascunho' })
    const { llm, chamadas } = fakeLlm(LEITURA)
    expect(await ingestDocument(deps(llm), id)).toBe('ignorado')
    expect(await ingestDocument(deps(llm), '00000000-0000-4000-8000-000000000000')).toBe('ignorado')
    expect(chamadas).toHaveLength(0)
    expect((await importacao(id)).status).toBe('rascunho')
  })

  it('Storage fora do ar: erro amigável, reserva devolvida', async () => {
    const { restaurantId, id } = await setup()
    const storage = { async baixarObjeto(): Promise<Uint8Array> { throw new Error('Storage respondeu HTTP 503') } }
    expect(await ingestDocument(deps(fakeLlm(LEITURA).llm, { storage }), id)).toBe('erro')
    expect((await importacao(id)).erro).toBe('Não consegui abrir o arquivo enviado. Envie de novo.')
    expect((await contadores(restaurantId)).map((c) => [c.reservado, c.gasto])).toEqual([['0.000000', '0.000000'], ['0.000000', '0.000000']])
  })

  it('importação presa em "processando" (worker morreu): o job seguinte devolve a reserva pendente e marca erro', async () => {
    const { restaurantId, id } = await setup()
    // o processo morto: marcou processando e reservou, sem liquidar
    await db.update(schema.knowledgeDocuments).set({ status: 'processando' }).where(eq(schema.knowledgeDocuments.id, id))
    await reserveBudget(db, { restaurantId, scope: 'ia', amountUsd: '0.50', timeZone: 'America/Sao_Paulo', ref: `importacao:${id}` })
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`
      await tx`update knowledge_documents set updated_at = now() - interval '6 minutes' where id = ${id}`
    })
    const { llm, chamadas } = fakeLlm(LEITURA)
    expect(await ingestDocument(deps(llm), id)).toBe('erro')
    expect(chamadas).toHaveLength(0)
    expect(await importacao(id)).toMatchObject({ status: 'erro', erro: 'A leitura demorou demais. Envie de novo.' })
    expect((await contadores(restaurantId)).map((c) => [c.reservado, c.gasto])).toEqual([['0.000000', '0.000000'], ['0.000000', '0.000000']])
  })

  it('arquivo baixado não é do tipo gravado (magic bytes): erro amigável, sem chamar a IA, reserva devolvida', async () => {
    const { restaurantId, id } = await setup()
    const { llm, chamadas } = fakeLlm(LEITURA)
    const storage = { async baixarObjeto() { return new TextEncoder().encode('<html>oi</html>') } }
    expect(await ingestDocument(deps(llm, { storage }), id)).toBe('erro')
    expect(chamadas).toHaveLength(0)
    expect((await importacao(id)).erro).toBe('O arquivo enviado não é um PDF nem uma imagem válida. Envie de novo.')
    expect((await contadores(restaurantId)).map((c) => c.reservado)).toEqual(['0.000000', '0.000000'])
  })
})

