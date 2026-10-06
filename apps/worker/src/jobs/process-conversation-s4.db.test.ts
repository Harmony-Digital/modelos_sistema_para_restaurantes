import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import { encryptPhone, keyFromBase64 } from '@atd/core'
import { abrirSimulacao, enviarMensagemSimulada, ingestInbound, schema, type Enqueue } from '@atd/db'
import { getTestDb, resetDb, seedRestaurant, seedStaff } from '@atd/db/test-utils'
import type { LlmClient, TriageV5 } from '@atd/ai'
import type { SendResult, UploadResult } from '@atd/whatsapp'
import { createLogger } from '../logger.ts'
import { processConversation, type ProcessDeps } from './process-conversation.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const phoneKey = keyFromBase64(Buffer.alloc(32, 7).toString('base64'))
const noopEnqueue: Enqueue = async () => undefined
const log = createLogger('silent')
const SEG_14H = new Date('2026-10-05T14:00:00-03:00')
const DIA = 86_400_000

type Item = TriageV5['itens'][number]
const card = (extra: Partial<Item> = {}): Item => ({
  servico: 'cardapio', tipo: 'buscar', unidade: null, data: null, tema: null, pessoas: null, horario: null,
  convidados: null, tipoEvento: null, espaco: null, consulta: null, tag: null, ...extra,
})
const triagem = (...itens: Item[]): TriageV5 => ({ itens, fora_escopo: false })
const ENVIAR = triagem(card({ tipo: 'enviar' }))

async function setup(o: { arquivo?: 'pdf' | 'jpeg' | null; asaNorte?: boolean } = {}) {
  const { restaurantId, unitId } = await seedRestaurant(db)
  await db.update(schema.restaurants).set({ nome: 'Casa Teste', politicaUrl: 'https://casa.test/privacidade' })
  await db.update(schema.units).set({ nome: 'Asa Sul', ordem: 1 }).where(eq(schema.units.id, unitId))
  let asaNorte: string | null = null
  if (o.asaNorte) {
    const [u] = await db.insert(schema.units).values({ restaurantId, nome: 'Asa Norte', slug: 'asa-norte', ordem: 2 }).returning()
    asaNorte = u!.id
    for (let d = 0; d < 7; d++) await db.insert(schema.unitHours).values({ restaurantId, unitId: asaNorte, weekday: d, turno: 1, abre: '11:00', fecha: '23:00' })
  }
  for (let d = 0; d < 7; d++) await db.insert(schema.unitHours).values({ restaurantId, unitId, weekday: d, turno: 1, abre: '11:00', fecha: '23:00' })
  await db.insert(schema.budgetLimits).values([
    { restaurantId, escopo: 'ia', periodo: 'dia', limiteUsd: '1' },
    { restaurantId, escopo: 'ia', periodo: 'mes', limiteUsd: '10' },
  ])
  const [carnes, bebidas] = await db.insert(schema.menuCategories).values([
    { restaurantId, nome: 'Carnes', ordem: 1 },
    { restaurantId, nome: 'Bebidas', ordem: 2 },
  ]).returning()
  await db.insert(schema.menuItems).values([
    { restaurantId, categoryId: carnes!.id, nome: 'Carne-de-sol', descricao: 'Com mandioca', precoCentavos: 5990, ordem: 1 },
    { restaurantId, categoryId: carnes!.id, nome: 'Picanha na chapa', precoCentavos: 8990, ordem: 2 },
    { restaurantId, categoryId: bebidas!.id, nome: 'Refrigerante lata', precoCentavos: 700, tags: ['bebida'] },
  ])
  let arquivoId: string | null = null
  if (o.arquivo !== null) {
    const pdf = (o.arquivo ?? 'pdf') === 'pdf'
    const [f] = await db.insert(schema.menuFiles).values({
      restaurantId, unitId: null, titulo: 'Cardápio da casa', storagePath: `cardapio/${restaurantId}/${pdf ? 'menu.pdf' : 'menu.jpg'}`,
      mime: pdf ? 'application/pdf' : 'image/jpeg', tamanho: 4, sha256: 'a'.repeat(64),
    }).returning()
    arquivoId = f!.id
  }
  return { restaurantId, unitId, arquivoId, asaNorte }
}

async function receive(restaurantId: string, texto: string) {
  const r = await ingestInbound(db, {
    restaurantId, waIdHash: 'hash-maria', telefoneCifrado: encryptPhone('5561999998888', phoneKey), profileName: 'Maria',
    timestamp: new Date(), wamid: `wamid.${randomUUID()}`, tipo: 'texto', texto, mediaId: null, interativoId: null,
  }, noopEnqueue)
  return r.conversationId
}

function fakeLlm(script: TriageV5[]) {
  const calls: { user: string; schemaName: string }[] = []
  const llm: LlmClient = {
    async completeJson(p) {
      calls.push({ user: p.user, schemaName: p.schemaName })
      return {
        ok: true as const, data: p.parse(script[Math.min(calls.length - 1, script.length - 1)]), model: 'fake/m',
        usage: { tokensIn: 100, tokensOut: 20, tokensCache: 0, costUsd: '0.000200' }, latencyMs: 10,
      }
    },
  }
  return { llm, calls }
}

/** Meta falsa: registra cada chamada; `recusarMidia` faz todo envio de documento/imagem falhar com o código de mídia. */
function fakeWa(o: { recusarMidia?: boolean } = {}) {
  const chamadas: { metodo: string; args: unknown[] }[] = []
  const ok = (): SendResult => ({ ok: true, wamid: `wamid.out.${randomUUID()}` })
  const recusa: SendResult = { ok: false, retryable: false, code: 131053, message: 'Media upload error' }
  let n = 0
  return {
    chamadas,
    async sendText(...args: unknown[]) { chamadas.push({ metodo: 'sendText', args }); return ok() },
    async sendLocation(...args: unknown[]) { chamadas.push({ metodo: 'sendLocation', args }); return ok() },
    async sendList(...args: unknown[]) { chamadas.push({ metodo: 'sendList', args }); return ok() },
    async sendDocument(...args: unknown[]) { chamadas.push({ metodo: 'sendDocument', args }); return o.recusarMidia ? recusa : ok() },
    async sendImage(...args: unknown[]) { chamadas.push({ metodo: 'sendImage', args }); return o.recusarMidia ? recusa : ok() },
    async uploadMedia(...args: unknown[]): Promise<UploadResult> {
      chamadas.push({ metodo: 'uploadMedia', args })
      return { ok: true, mediaId: `MEDIA-NOVO-${++n}` }
    },
  }
}

const BYTES_PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46])
const BYTES_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])

/** Storage falso: devolve bytes de acordo com a extensão (ou `conteudo`, para simular arquivo trocado). */
function fakeStorage(conteudo?: Uint8Array) {
  const baixados: { bucket: string; caminho: string }[] = []
  return {
    baixados,
    async baixarObjeto(bucket: string, caminho: string) {
      baixados.push({ bucket, caminho })
      return conteudo ?? (caminho.endsWith('.jpg') ? BYTES_JPEG : BYTES_PDF)
    },
  }
}

const deps = (llm: LlmClient, wa: ProcessDeps['wa'], storage: ProcessDeps['storage'] = fakeStorage()): ProcessDeps =>
  ({ db, llm, wa, storage, phoneKey, triageModels: ['fake/m'], log, requeue: async () => undefined, now: () => SEG_14H })
const saidas = (conversationId: string) =>
  db.select().from(schema.messages).where(eq(schema.messages.conversationId, conversationId)).orderBy(asc(schema.messages.id))
    .then((ms) => ms.filter((m) => m.direcao === 'out' && m.replyKey !== 'avisoPrivacidade'))
const metodos = (wa: ReturnType<typeof fakeWa>) => wa.chamadas.map((c) => c.metodo)
const arquivo = async (id: string) => (await db.select().from(schema.menuFiles).where(eq(schema.menuFiles.id, id)))[0]!

describe('S4 no worker — perguntas sobre o cardápio', () => {
  it('"tem carne de sol?" ⇒ texto com o preço do banco; triage-v5 em ai_runs', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'tem carne de sol?')
    const { llm, calls } = fakeLlm([triagem(card({ consulta: 'carne de sol' }))])
    const wa = fakeWa()
    expect(await processConversation(deps(llm, wa), conv)).toBe('replied')
    expect(calls[0]!.schemaName).toBe('triagem_v5')
    const [m] = await saidas(conv)
    expect(m!.texto).toContain('Carne-de-sol')
    expect(m!.texto).toContain('R$ 59,90')
    const [run] = await db.select().from(schema.aiRuns)
    expect(run).toMatchObject({ promptVersion: 'triage-v5', intent: 'cardapio:buscar', itensValidos: 1, itensRespondidos: 1 })
    expect(metodos(wa)).not.toContain('uploadMedia')
  })

  it('filtro por tag e item que não existe (lacuna registrada)', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'que bebidas tem? e tem lagosta?')
    const { llm } = fakeLlm([triagem(card({ tipo: 'filtro', tag: 'bebida' }), card({ consulta: 'lagosta' }))])
    await processConversation(deps(llm, fakeWa()), conv)
    const [m] = await saidas(conv)
    expect(m!.texto).toContain('Refrigerante lata')
    expect(m!.texto).toContain('R$ 7,00')
    expect(m!.texto).toContain('Não encontrei esse item no cardápio.')
    const lacunas = await db.select().from(schema.knowledgeGaps)
    expect(lacunas.map((l) => l.chaveNormalizada)).toEqual(['cardapio:lagosta'])
  })

  it('sem arquivo: "manda o cardápio" responde o resumo do banco em texto', async () => {
    const { restaurantId } = await setup({ arquivo: null })
    const conv = await receive(restaurantId, 'manda o cardápio')
    const wa = fakeWa()
    await processConversation(deps(fakeLlm([ENVIAR]).llm, wa), conv)
    const out = await saidas(conv)
    expect(out).toHaveLength(1)
    expect(out[0]!.texto).toMatch(/^Nosso cardápio:\n/)
    expect(out[0]!.texto).toContain('Carne-de-sol (R$ 59,90)')
    expect(metodos(wa)).not.toContain('uploadMedia')
  })
})

describe('S4 no worker — envio do arquivo', () => {
  it('simulação: mensagem documento gravada como "simulado"; nunca Meta nem Storage', async () => {
    const { restaurantId, arquivoId } = await setup()
    const dono = await seedStaff(db, sql, { restaurantId, papel: 'dono' })
    const { conversationId } = await abrirSimulacao(db, { restaurantId, userId: dono })
    await enviarMensagemSimulada(db, { restaurantId, userId: dono, conversationId, texto: 'manda o cardápio' }, noopEnqueue)
    const proibido = new Proxy({}, { get: () => () => { throw new Error('Meta chamada em simulação') } }) as ProcessDeps['wa']
    const storage = fakeStorage()
    expect(await processConversation(deps(fakeLlm([ENVIAR]).llm, proibido, storage), conversationId)).toBe('replied')
    const out = await saidas(conversationId)
    expect(out.map((m) => [m.tipo, m.statusEnvio])).toEqual([['texto', 'simulado'], ['documento', 'simulado']])
    expect(out[0]!.texto).toBe('Aqui está o nosso cardápio.')
    expect(out[1]!.payload).toMatchObject({ arquivoId })
    expect(out[1]!.texto).toBe('Cardápio da casa')
    expect(storage.baixados).toEqual([])
  })

  it('real com media id válido em cache: envia o documento sem subir de novo', async () => {
    const { restaurantId, arquivoId } = await setup()
    await db.update(schema.menuFiles).set({ waMediaId: 'MEDIA-CACHE', waMediaExpiresAt: new Date(SEG_14H.getTime() + 10 * DIA) })
    const conv = await receive(restaurantId, 'manda o cardápio')
    const wa = fakeWa()
    const storage = fakeStorage()
    await processConversation(deps(fakeLlm([ENVIAR]).llm, wa, storage), conv)
    expect(storage.baixados).toEqual([])
    const doc = wa.chamadas.find((c) => c.metodo === 'sendDocument')!
    expect(doc.args).toEqual(['5561999998888', { mediaId: 'MEDIA-CACHE', filename: 'Cardápio da casa.pdf', caption: 'Cardápio da casa' }])
    expect(wa.chamadas.some((c) => c.metodo === 'uploadMedia')).toBe(false)
    const out = await saidas(conv)
    expect(out.map((m) => [m.tipo, m.statusEnvio])).toEqual([['texto', 'enviado'], ['documento', 'enviado']])
    expect((await arquivo(arquivoId!)).waMediaId).toBe('MEDIA-CACHE')
  })

  it('cache vencido: baixa do Storage, sobe para a Meta e guarda o media id por 29 dias', async () => {
    const { restaurantId, arquivoId } = await setup()
    await db.update(schema.menuFiles).set({ waMediaId: 'MEDIA-VELHO', waMediaExpiresAt: new Date(SEG_14H.getTime() - 1000) })
    const conv = await receive(restaurantId, 'manda o cardápio')
    const wa = fakeWa()
    const storage = fakeStorage()
    await processConversation(deps(fakeLlm([ENVIAR]).llm, wa, storage), conv)
    expect(storage.baixados).toEqual([{ bucket: 'cardapio', caminho: `${restaurantId}/menu.pdf` }])
    const up = wa.chamadas.find((c) => c.metodo === 'uploadMedia')!
    expect(up.args).toEqual([new Uint8Array([0x25, 0x50, 0x44, 0x46]), 'application/pdf', 'Cardápio da casa.pdf'])
    expect(wa.chamadas.find((c) => c.metodo === 'sendDocument')!.args[1]).toMatchObject({ mediaId: 'MEDIA-NOVO-1' })
    const f = await arquivo(arquivoId!)
    expect(f.waMediaId).toBe('MEDIA-NOVO-1')
    expect(f.waMediaExpiresAt!.getTime()).toBe(SEG_14H.getTime() + 29 * DIA)
  })

  it('imagem (JPEG) sai como imagem com legenda', async () => {
    const { restaurantId } = await setup({ arquivo: 'jpeg' })
    const conv = await receive(restaurantId, 'manda o cardápio')
    const wa = fakeWa()
    await processConversation(deps(fakeLlm([ENVIAR]).llm, wa), conv)
    expect(wa.chamadas.find((c) => c.metodo === 'sendImage')!.args[1]).toEqual({ mediaId: 'MEDIA-NOVO-1', caption: 'Cardápio da casa' })
    expect((await saidas(conv)).map((m) => m.tipo)).toEqual(['texto', 'imagem'])
  })

  it('Meta recusa a mídia: limpa o cache e sobe de novo uma vez; depois manda o resumo em texto', async () => {
    const { restaurantId, arquivoId } = await setup()
    await db.update(schema.menuFiles).set({ waMediaId: 'MEDIA-CACHE', waMediaExpiresAt: new Date(SEG_14H.getTime() + 10 * DIA) })
    const conv = await receive(restaurantId, 'manda o cardápio')
    const wa = fakeWa({ recusarMidia: true })
    await processConversation(deps(fakeLlm([ENVIAR]).llm, wa), conv)
    const seq = wa.chamadas.map((c) => c.metodo).filter((m) => m !== 'sendText')
    expect(seq).toEqual(['sendDocument', 'uploadMedia', 'sendDocument'])
    const textos = wa.chamadas.filter((c) => c.metodo === 'sendText').map((c) => c.args[1] as string)
    expect(textos.at(-1)).toMatch(/^Nosso cardápio:\n/)
    expect(textos.at(-1)).toContain('Carne-de-sol (R$ 59,90)')
    const out = await saidas(conv)
    // o registro mostra o que o cliente recebeu de fato
    expect(out.map((m) => [m.tipo, m.statusEnvio])).toEqual([['texto', 'enviado'], ['texto', 'enviado']])
    expect(out[1]!.texto).toMatch(/^Nosso cardápio:/)
    // o id recusado não fica no cache
    expect((await arquivo(arquivoId!)).waMediaId).toBeNull()
  })

  it('arquivo desativado depois da decisão: manda o resumo em texto', async () => {
    const { restaurantId, arquivoId } = await setup()
    const conv = await receive(restaurantId, 'manda o cardápio')
    const wa = fakeWa()
    // desativa no meio: entre o commit e a entrega (via Storage falso, que só roda na entrega)
    const storage = {
      async baixarObjeto(): Promise<Uint8Array> { throw new Error('não deveria baixar') },
    }
    const llm: LlmClient = {
      async completeJson(p) {
        return { ok: true as const, data: p.parse(ENVIAR), model: 'fake/m', usage: { tokensIn: 1, tokensOut: 1, tokensCache: 0, costUsd: '0' }, latencyMs: 1 }
      },
    }
    // a decisão vê o arquivo; desativamos antes de processar de novo a entrega
    const d = deps(llm, { ...wa, sendText: async (...a: unknown[]) => { await db.update(schema.menuFiles).set({ ativo: false }).where(eq(schema.menuFiles.id, arquivoId!)); return wa.sendText(...a) } }, storage)
    await processConversation(d, conv)
    const out = await saidas(conv)
    expect(out.map((m) => m.tipo)).toEqual(['texto', 'texto'])
    expect(out[1]!.texto).toMatch(/^Nosso cardápio:/)
    expect(wa.chamadas.some((c) => c.metodo === 'sendDocument' || c.metodo === 'uploadMedia')).toBe(false)
  })
})

describe('S4 no worker — correções do Bloco B', () => {
  it('sem arquivo e duas unidades, nenhuma citada: preço que varia sai sem preço; indisponível em todas não aparece', async () => {
    const { restaurantId, unitId, asaNorte } = await setup({ arquivo: null, asaNorte: true })
    const [picanha] = await db.select().from(schema.menuItems).where(eq(schema.menuItems.nome, 'Picanha na chapa'))
    const [carne] = await db.select().from(schema.menuItems).where(eq(schema.menuItems.nome, 'Carne-de-sol'))
    await db.insert(schema.menuItemUnits).values([
      { restaurantId, itemId: picanha!.id, unitId: asaNorte!, precoOverrideCentavos: 9500 },
      { restaurantId, itemId: carne!.id, unitId, disponivel: false },
      { restaurantId, itemId: carne!.id, unitId: asaNorte!, disponivel: false },
    ])
    const conv = await receive(restaurantId, 'manda o cardápio')
    await processConversation(deps(fakeLlm([ENVIAR]).llm, fakeWa()), conv)
    const [m] = await saidas(conv)
    expect(m!.texto).toContain('Picanha na chapa (preço varia por unidade)')
    expect(m!.texto).not.toContain('R$ 89,90')
    expect(m!.texto).not.toContain('Carne-de-sol')
  })

  it('sem arquivo e uma unidade ativa só: preço efetivo dela (não o padrão)', async () => {
    const { restaurantId, unitId } = await setup({ arquivo: null })
    const [picanha] = await db.select().from(schema.menuItems).where(eq(schema.menuItems.nome, 'Picanha na chapa'))
    await db.insert(schema.menuItemUnits).values({ restaurantId, itemId: picanha!.id, unitId, precoOverrideCentavos: 9900 })
    const conv = await receive(restaurantId, 'manda o cardápio')
    await processConversation(deps(fakeLlm([ENVIAR]).llm, fakeWa()), conv)
    const [m] = await saidas(conv)
    expect(m!.texto).toContain('Picanha na chapa (R$ 99,00)')
    expect(m!.texto).not.toContain('R$ 89,90')
  })

  it('duas unidades sem arquivo próprio na mesma mensagem: o arquivo geral sai uma vez só', async () => {
    const { restaurantId } = await setup({ asaNorte: true })
    const conv = await receive(restaurantId, 'cardápio da asa sul e da asa norte')
    const wa = fakeWa()
    await processConversation(deps(fakeLlm([triagem(card({ tipo: 'enviar', unidade: 'asa sul' }), card({ tipo: 'enviar', unidade: 'asa norte' }))]).llm, wa), conv)
    expect((await saidas(conv)).map((m) => m.tipo)).toEqual(['texto', 'documento'])
    expect(wa.chamadas.filter((c) => c.metodo === 'sendDocument')).toHaveLength(1)
  })

  it('arquivo no Storage não bate com o tipo gravado (magic bytes): não sobe à Meta; manda o resumo em texto', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'manda o cardápio')
    const wa = fakeWa()
    await processConversation(deps(fakeLlm([ENVIAR]).llm, wa, fakeStorage(new TextEncoder().encode('<html>'))), conv)
    expect(wa.chamadas.some((c) => c.metodo === 'uploadMedia' || c.metodo === 'sendDocument')).toBe(false)
    const out = await saidas(conv)
    expect(out.map((m) => m.tipo)).toEqual(['texto', 'texto'])
    expect(out[1]!.texto).toMatch(/^Nosso cardápio:/)
  })
})

