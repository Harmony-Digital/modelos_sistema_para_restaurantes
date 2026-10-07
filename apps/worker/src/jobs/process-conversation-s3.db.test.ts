import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import { encryptPhone, keyFromBase64 } from '@atd/core'
import { abrirSimulacao, enviarMensagemSimulada, ingestInbound, schema, type Enqueue, type EspacoS3, type PedidoAtivo } from '@atd/db'
import { getTestDb, resetDb, seedRestaurant, seedStaff } from '@atd/db/test-utils'
import type * as DbModule from '@atd/db'
import type { LlmClient, TriageV5 } from '@atd/ai'
import type { SendResult } from '@atd/whatsapp'
import { createLogger } from '../logger.ts'
import { comMidiaProibida, storageProibido } from './midia-fake.ts'
import { processConversation, type ProcessDeps } from './process-conversation.ts'
import { comoV7 } from './triagem-falsa.ts'

// defeitos simulados do core/leitura: pedidos de outro cliente; espaço atribuído à unidade errada
const injecao = vi.hoisted(() => ({
  pedidos: null as null | PedidoAtivo[],
  espacos: null as null | EspacoS3[],
}))
vi.mock('@atd/db', async (importOriginal) => {
  const orig = await importOriginal<typeof DbModule>()
  return {
    ...orig,
    pedidosDoCliente: (...args: Parameters<typeof orig.pedidosDoCliente>) =>
      injecao.pedidos ? Promise.resolve(injecao.pedidos) : orig.pedidosDoCliente(...args),
    espacosAtivos: (...args: Parameters<typeof orig.espacosAtivos>) =>
      injecao.espacos ? Promise.resolve(injecao.espacos) : orig.espacosAtivos(...args),
  }
})

const { db, sql } = getTestDb()
beforeEach(() => {
  injecao.pedidos = null
  injecao.espacos = null
  return resetDb(sql)
})
afterAll(() => sql.end())

const phoneKey = keyFromBase64(Buffer.alloc(32, 7).toString('base64'))
const noopEnqueue: Enqueue = async () => undefined
const log = createLogger('silent')
const SEG_14H = new Date('2026-10-05T14:00:00-03:00')

type Item = TriageV5['itens'][number] & { nome?: string | null; contato_ok?: boolean | null }
const ev = (extra: Partial<Item> = {}): Item => ({
  servico: 'evento', tipo: 'pedido', unidade: null, data: null, tema: null, pessoas: null, horario: null,
  convidados: null, tipoEvento: null, espaco: null, consulta: null, tag: null, ...extra,
})
const cancelarEv = (extra: Partial<Item> = {}) => ev({ tipo: 'cancelar', ...extra })
const triagem = (...itens: Item[]): TriageV5 => ({ itens, fora_escopo: false })
const COMPLETO = { unidade: 'asa sul', data: '20/10', convidados: 40, tipoEvento: 'aniversário' } as const

async function setup(nUnidades: 1 | 4 = 1) {
  const { restaurantId, unitId } = await seedRestaurant(db)
  await db.update(schema.restaurants).set({ nome: 'Casa Teste', politicaUrl: 'https://casa.test/privacidade' })
  await db.update(schema.units).set({ nome: 'Asa Sul', ordem: 1 }).where(eq(schema.units.id, unitId))
  const ids: Record<string, string> = { 'Asa Sul': unitId }
  if (nUnidades === 4) {
    for (const [i, nome] of ['Asa Norte', 'Lago Sul', 'Águas Claras'].entries()) {
      const [u] = await db.insert(schema.units).values({ restaurantId, nome, slug: `u${i}`, ordem: i + 2 }).returning()
      ids[nome] = u!.id
    }
  }
  for (const id of Object.values(ids)) {
    for (let d = 0; d < 7; d++) await db.insert(schema.unitHours).values({ restaurantId, unitId: id, weekday: d, turno: 1, abre: '11:00', fecha: '23:00' })
  }
  await db.insert(schema.budgetLimits).values([
    { restaurantId, escopo: 'ia', periodo: 'dia', limiteUsd: '1' },
    { restaurantId, escopo: 'ia', periodo: 'mes', limiteUsd: '10' },
    { restaurantId, escopo: 'simulacao', periodo: 'dia', limiteUsd: '1' }, // conversa simulada tem limite próprio
    { restaurantId, escopo: 'simulacao', periodo: 'mes', limiteUsd: '10' },
  ])
  const espacos = await db.insert(schema.eventSpaces).values([
    { restaurantId, unitId, nome: 'Varanda', capacidadeMin: 10, capacidadeMax: 30 },
    { restaurantId, unitId, nome: 'Salão', capacidadeMin: 30, capacidadeMax: 80 },
  ]).returning()
  const espaco = Object.fromEntries(espacos.map((e) => [e.nome, e.id])) as Record<'Varanda' | 'Salão', string>
  return { restaurantId, ids, espaco }
}

async function receive(restaurantId: string, texto: string, interativoId: string | null = null, cliente = 'maria') {
  const tel = cliente === 'maria' ? '5561999998888' : '5561988887777'
  const r = await ingestInbound(db, {
    restaurantId, waIdHash: `hash-${cliente}`, telefoneCifrado: encryptPhone(tel, phoneKey), profileName: cliente === 'maria' ? 'Maria' : 'Bia',
    timestamp: new Date(), wamid: `wamid.${randomUUID()}`, tipo: 'texto', texto, mediaId: null, interativoId,
  }, noopEnqueue)
  return r.conversationId
}

function fakeLlm(script: TriageV5[], aoChamar?: () => Promise<void>) {
  const calls: string[] = []
  const llm: LlmClient = {
    async completeJson(p) {
      calls.push(p.user)
      if (aoChamar) await aoChamar()
      return {
        ok: true as const, data: p.parse(comoV7(script[Math.min(calls.length - 1, script.length - 1)]!)), model: 'fake/m',
        usage: { tokensIn: 100, tokensOut: 20, tokensCache: 0, costUsd: '0.000200' }, latencyMs: 10,
      }
    },
  }
  return { llm, calls }
}

function fakeWa() {
  const enviados: { tipo: string; to: string; corpo: unknown }[] = []
  const ok = (): SendResult => ({ ok: true, wamid: `wamid.out.${randomUUID()}` })
  return {
    enviados,
    async sendText(to: string, texto: string) { enviados.push({ tipo: 'texto', to, corpo: texto }); return ok() },
    async sendLocation(to: string, loc: unknown) { enviados.push({ tipo: 'localizacao', to, corpo: loc }); return ok() },
    async sendList(to: string, l: unknown) { enviados.push({ tipo: 'lista', to, corpo: l }); return ok() },
  }
}

const deps = (llm: LlmClient, wa: Parameters<typeof comMidiaProibida>[0]): ProcessDeps =>
  ({ db, llm, wa: comMidiaProibida(wa), storage: storageProibido, phoneKey, triageModels: ['fake/m'], log, requeue: async () => undefined, now: () => SEG_14H })
const conversa = async (id: string) => (await db.select().from(schema.conversations).where(eq(schema.conversations.id, id)))[0]!
const pedidos = () => db.select().from(schema.eventRequests).orderBy(asc(schema.eventRequests.createdAt))
const ultimoTexto = (wa: ReturnType<typeof fakeWa>) => wa.enviados.at(-1)!.corpo as string
const acoesAudit = async () =>
  (await db.select({ acao: schema.auditLog.acao, entidade: schema.auditLog.entidade, atorTipo: schema.auditLog.atorTipo, entidadeId: schema.auditLog.entidadeId })
    .from(schema.auditLog).orderBy(asc(schema.auditLog.id)))
    .filter((a) => a.acao.startsWith('evento.') || a.acao.startsWith('conversa.'))

describe('S3 no worker', () => {
  it('pedido completo numa mensagem ⇒ "Recebemos seu pedido…", linha novo, triage-v7 e audit_log', async () => {
    const { restaurantId, ids } = await setup()
    const conv = await receive(restaurantId, 'quero fazer um aniversário pra 40 pessoas na asa sul dia 20/10')
    const { llm, calls } = fakeLlm([triagem(ev(COMPLETO))])
    const wa = fakeWa()
    expect(await processConversation(deps(llm, wa), conv)).toBe('replied')
    expect(calls[0]).not.toContain('<pergunta_pendente>')
    const texto = ultimoTexto(wa)
    expect(texto).toMatch(/^Recebemos seu pedido de aniversário para 40 convidados na unidade Asa Sul, /)
    expect(texto).not.toMatch(/confirmad|reservad/i)
    // sem espaço citado: lista os que comportam o grupo
    expect(texto).toContain('• Salão (Asa Sul) — 30 a 80 pessoas.')
    const [p] = await pedidos()
    expect(p).toMatchObject({
      restaurantId, unitId: ids['Asa Sul'], spaceId: null, data: '2026-10-20', convidados: 40, tipo: 'aniversario',
      tipoTexto: null, status: 'novo', nome: 'Maria', simulado: false, // texto do tipo só quando é "outro" (minimização)
    })
    expect(p!.customerId).toBe((await conversa(conv)).customerId)
    const [run] = await db.select().from(schema.aiRuns)
    expect(run).toMatchObject({ promptVersion: 'triage-v7', intent: 'evento:pedido', itensValidos: 1, itensRespondidos: 1 })
    expect(await acoesAudit()).toEqual([{ acao: 'evento.pedido_criado', entidade: 'event_request', atorTipo: 'ia', entidadeId: p!.id }])
    expect((await conversa(conv)).pendente).toBeNull()
  })

  it('coleta em 4 mensagens: lista ⇒ toque ⇒ data ⇒ convidados ⇒ tipo ⇒ registra, com a pergunta pendente na triagem', async () => {
    const { restaurantId, ids } = await setup(4)
    const conv = await receive(restaurantId, 'quero fazer um evento')
    const { llm, calls } = fakeLlm([
      triagem(ev()),
      triagem(ev({ unidade: 'Asa Norte', data: 'dia 20' })),
      triagem(ev({ unidade: 'Asa Norte', data: '2026-10-20', convidados: 40 })),
      triagem(ev({ unidade: 'Asa Norte', data: '2026-10-20', convidados: 40, tipoEvento: 'aniversário' })),
    ])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    expect(wa.enviados.at(-1)).toMatchObject({ tipo: 'lista', corpo: { corpo: 'Para qual unidade é o evento? Toque em "Ver unidades" e escolha.' } })
    expect((await conversa(conv)).pendente).toMatchObject({ tipo: 'unidade', itens: [ev()] })

    // toque na lista: sem LLM
    await receive(restaurantId, 'Selecionado', ids['Asa Norte']!)
    await processConversation(deps(llm, wa), conv)
    expect(calls).toHaveLength(1)
    expect(ultimoTexto(wa)).toBe('Para qual data é o evento?')
    expect((await conversa(conv)).pendente).toMatchObject({
      tipo: 'pedido_evento', campo: 'data', pergunta: 'Para qual data é o evento?', unitId: ids['Asa Norte'],
      item: { servico: 'evento', unidade: 'Asa Norte' }, expiraEm: '2026-10-05T18:00:00.000Z', // 60 min
    })

    await receive(restaurantId, 'dia 20')
    await processConversation(deps(llm, wa), conv)
    expect(calls[1]).toContain('<pergunta_pendente>\nPara qual data é o evento?\n</pergunta_pendente>')
    expect(calls[1]).toContain('<pedido_em_andamento>\n{"servico":"evento","unidade":"Asa Norte"}\n</pedido_em_andamento>')
    expect(calls[1]).toContain('<mensagem_cliente>\ndia 20\n</mensagem_cliente>')
    expect(ultimoTexto(wa)).toBe('Para quantos convidados?')

    await receive(restaurantId, 'uns 40')
    await processConversation(deps(llm, wa), conv)
    expect(calls[2]).toContain('<pergunta_pendente>\nPara quantos convidados?\n</pergunta_pendente>')
    expect(calls[2]).toContain('{"servico":"evento","unidade":"Asa Norte","data":"2026-10-20"}')
    expect(ultimoTexto(wa)).toBe('Qual o tipo do evento? (aniversário, casamento, corporativo, confraternização…)')
    expect(await pedidos()).toHaveLength(0)

    await receive(restaurantId, 'aniversário')
    await processConversation(deps(llm, wa), conv)
    expect(calls).toHaveLength(4)
    expect(calls[3]).toContain('{"servico":"evento","unidade":"Asa Norte","data":"2026-10-20","convidados":40}')
    expect(ultimoTexto(wa)).toMatch(/^Recebemos seu pedido de aniversário para 40 convidados na unidade Asa Norte, /)
    expect(await pedidos()).toMatchObject([{ unitId: ids['Asa Norte'], data: '2026-10-20', convidados: 40, tipo: 'aniversario', status: 'novo' }])
    expect((await conversa(conv)).pendente).toBeNull()
  })

  it('coleta com a triagem devolvendo SÓ o campo respondido: o worker completa pelo pendente e resolve a unidade pelo id', async () => {
    const { restaurantId, ids } = await setup(4)
    const conv = await receive(restaurantId, 'quero fazer um evento')
    const { llm, calls } = fakeLlm([
      triagem(ev()),
      triagem(ev({ data: 'dia 20' })),
      triagem(ev({ convidados: 40 })),
      triagem(ev({ tipoEvento: 'aniversário' })),
    ])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    await receive(restaurantId, 'Selecionado', ids['Asa Norte']!)
    await processConversation(deps(llm, wa), conv)
    expect(ultimoTexto(wa)).toBe('Para qual data é o evento?')
    // renomeada no meio: a unidade vem do id guardado, não do nome
    await db.update(schema.units).set({ nome: 'Plano Piloto' }).where(eq(schema.units.id, ids['Asa Norte']!))

    await receive(restaurantId, 'dia 20')
    await processConversation(deps(llm, wa), conv)
    expect(ultimoTexto(wa)).toBe('Para quantos convidados?')
    expect((await conversa(conv)).pendente).toMatchObject({ campo: 'convidados', unitId: ids['Asa Norte'], item: { data: '2026-10-20' } })

    await receive(restaurantId, 'uns 40')
    await processConversation(deps(llm, wa), conv)
    expect(ultimoTexto(wa)).toBe('Qual o tipo do evento? (aniversário, casamento, corporativo, confraternização…)')
    expect((await conversa(conv)).pendente).toMatchObject({ campo: 'tipo', item: { data: '2026-10-20', convidados: 40 } })

    await receive(restaurantId, 'aniversário')
    await processConversation(deps(llm, wa), conv)
    expect(calls).toHaveLength(4)
    expect(wa.enviados.filter((e) => e.tipo === 'lista')).toHaveLength(1) // a lista não reabre
    expect(ultimoTexto(wa)).toMatch(/^Recebemos seu pedido de aniversário para 40 convidados na unidade Plano Piloto, /)
    expect(await pedidos()).toMatchObject([{ unitId: ids['Asa Norte'], data: '2026-10-20', convidados: 40, tipo: 'aniversario' }])
  })

  it('correção explícita do cliente vale sobre o pendente (tipo e espaço novos)', async () => {
    const { restaurantId, espaco } = await setup()
    const conv = await receive(restaurantId, 'aniversário pra 40 na varanda da asa sul dia 20/10')
    const { llm } = fakeLlm([
      triagem(ev({ ...COMPLETO, espaco: 'varanda' })),
      triagem(ev({ tipoEvento: 'casamento', espaco: 'salão' })),
    ])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    expect((await conversa(conv)).pendente).toMatchObject({ tipo: 'pedido_evento', campo: 'espaco' })
    await receive(restaurantId, 'na verdade é casamento, no salão')
    await processConversation(deps(llm, wa), conv)
    expect(ultimoTexto(wa)).toMatch(/^Recebemos seu pedido de casamento para 40 convidados na unidade Asa Sul, .*, no espaço Salão\./)
    expect(await pedidos()).toMatchObject([{ tipo: 'casamento', spaceId: espaco['Salão'], data: '2026-10-20' }])
  })

  it('pergunta de capacidade longa (muitas sugestões) é guardada inteira no pendente', async () => {
    const { restaurantId, ids } = await setup()
    const nomes = Array.from({ length: 12 }, (_, i) => `Espaço com nome comprido número ${i + 1}`)
    await db.insert(schema.eventSpaces).values(nomes.map((nome) => ({ restaurantId, unitId: ids['Asa Sul']!, nome, capacidadeMin: 30, capacidadeMax: 80 })))
    const conv = await receive(restaurantId, 'aniversário pra 40 na varanda da asa sul dia 20/10')
    const wa = fakeWa()
    await processConversation(deps(fakeLlm([triagem(ev({ ...COMPLETO, espaco: 'varanda' }))]).llm, wa), conv)
    const texto = ultimoTexto(wa)
    expect(texto.length).toBeGreaterThan(300)
    expect((await conversa(conv)).pendente).toMatchObject({ tipo: 'pedido_evento', campo: 'espaco', pergunta: texto })
  })

  it('espaço sem capacidade ⇒ sugestões e nada gravado; "pode ser qualquer um" ⇒ registra sem espaço', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'aniversário pra 40 na varanda da asa sul dia 20/10')
    const { llm, calls } = fakeLlm([
      triagem(ev({ ...COMPLETO, espaco: 'varanda' })),
      triagem(ev({ unidade: 'Asa Sul', data: '2026-10-20', convidados: 40, tipoEvento: 'aniversário', espaco: '*' })),
    ])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    expect(ultimoTexto(wa)).toBe(
      'O espaço Varanda recebe de 10 a 30 pessoas. Para 40 pessoas, sugiro: Salão. Qual espaço prefere? Se tanto faz, diga "pode ser qualquer um".',
    )
    expect(await pedidos()).toHaveLength(0)
    expect((await conversa(conv)).pendente).toMatchObject({ tipo: 'pedido_evento', campo: 'espaco' })

    await receive(restaurantId, 'pode ser qualquer um')
    await processConversation(deps(llm, wa), conv)
    expect(calls[1]).toContain('Qual espaço prefere?')
    expect(calls[1]).toContain('{"servico":"evento","unidade":"Asa Sul","data":"2026-10-20","convidados":40,"tipo":"aniversário"}')
    expect(ultimoTexto(wa)).toMatch(/^Recebemos seu pedido de aniversário para 40 convidados na unidade Asa Sul, .*\. Nossa equipe/)
    expect(ultimoTexto(wa)).not.toContain('Espaços para eventos')
    expect(await pedidos()).toMatchObject([{ spaceId: null, status: 'novo' }])
  })

  it('tipo "outro" e espaço citados no início sobrevivem à coleta sem ir à triagem como texto livre', async () => {
    const { restaurantId, espaco } = await setup()
    const conv = await receive(restaurantId, 'quero fazer minha formatura no salão da asa sul pra 40')
    const { llm, calls } = fakeLlm([
      triagem(ev({ unidade: 'asa sul', convidados: 40, tipoEvento: 'formatura', espaco: 'salão' })),
      triagem(ev({ unidade: 'Asa Sul', data: '2026-10-20', convidados: 40, tipoEvento: 'outro' })),
    ])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    expect(ultimoTexto(wa)).toBe('Para qual data é o evento?')
    await receive(restaurantId, 'dia 20')
    await processConversation(deps(llm, wa), conv)
    expect(calls[1]).toContain('{"servico":"evento","unidade":"Asa Sul","convidados":40,"tipo":"outro"}')
    expect(calls[1]).not.toMatch(/formatura|sal[aã]o/i)
    expect(ultimoTexto(wa)).toMatch(/^Recebemos seu pedido de evento para 40 convidados na unidade Asa Sul, .*, no espaço Salão\./)
    expect(await pedidos()).toMatchObject([{ tipo: 'outro', tipoTexto: 'formatura', spaceId: espaco['Salão'] }])
  })

  it('pedido já registrado: o pedido repetido não duplica (1 linha só)', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'quero fazer um aniversário pra 40 pessoas na asa sul dia 20/10')
    const { llm } = fakeLlm([triagem(ev(COMPLETO)), triagem(ev(COMPLETO))])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    expect(ultimoTexto(wa)).toMatch(/^Recebemos seu pedido/)
    const ja = /^Já temos seu pedido de aniversário para 40 convidados na unidade Asa Sul, .*\. Nossa equipe vai entrar em contato para confirmar\.$/
    await receive(restaurantId, 'quero fazer um aniversário pra 40 pessoas na asa sul dia 20/10')
    await processConversation(deps(llm, wa), conv)
    expect(ultimoTexto(wa)).toMatch(ja)
    expect(ultimoTexto(wa)).not.toMatch(/confirmad|reservad/i)
    expect(await pedidos()).toHaveLength(1)
    expect((await conversa(conv)).pendente).toBeNull()
  })

  it('pedido já registrado sem espaço e o cliente cita um ("quero o salão"): é mudança — equipe + observação, sem duplicar', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'quero fazer um aniversário pra 40 pessoas na asa sul dia 20/10')
    const { llm } = fakeLlm([triagem(ev(COMPLETO)), triagem(ev({ unidade: 'asa sul', data: '20/10', espaco: 'salão' }))])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    await receive(restaurantId, 'quero o salão')
    await processConversation(deps(llm, wa), conv)
    expect(ultimoTexto(wa)).toBe('Anotei o que você pediu e vou chamar a equipe para ajustar seu pedido de evento.')
    expect(await pedidos()).toMatchObject([{ spaceId: null, observacoes: 'Cliente pediu: espaço Salão' }])
    expect((await conversa(conv)).estado).toBe('aguardando_humano')
  })

  it('espaço citado que comporta ⇒ grava o space_id', async () => {
    const { restaurantId, espaco } = await setup()
    const conv = await receive(restaurantId, 'aniversário pra 40 no salão da asa sul dia 20/10')
    const wa = fakeWa()
    await processConversation(deps(fakeLlm([triagem(ev({ ...COMPLETO, espaco: 'salão' }))]).llm, wa), conv)
    expect(ultimoTexto(wa)).toContain(', no espaço Salão.')
    expect(await pedidos()).toMatchObject([{ spaceId: espaco['Salão'] }])
  })

  it('defeito do core: espaço de outra unidade ⇒ o banco recusa e nada é gravado', async () => {
    const { restaurantId, ids, espaco } = await setup(4)
    // o espaço "Salão" é da Asa Sul; a leitura defeituosa diz que é da Asa Norte
    injecao.espacos = [{ id: espaco['Salão'], unitId: ids['Asa Norte']!, nome: 'Salão', capacidadeMin: 30, capacidadeMax: 80, descricao: null, condicoes: null }]
    const conv = await receive(restaurantId, 'aniversário pra 40 no salão da asa norte dia 20/10')
    const wa = fakeWa()
    await expect(processConversation(deps(fakeLlm([triagem(ev({ ...COMPLETO, unidade: 'asa norte', espaco: 'salão' }))]).llm, wa), conv))
      .rejects.toThrow()
    expect(await pedidos()).toHaveLength(0)
    expect(await acoesAudit()).toHaveLength(0)
    expect((await conversa(conv)).processedUpToId).toBe(0)
  })

  it('cancela o próprio pedido e registra no audit_log', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'aniversário pra 40 na asa sul dia 20/10')
    const { llm } = fakeLlm([triagem(ev(COMPLETO)), triagem(cancelarEv())])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    await receive(restaurantId, 'cancela meu pedido de evento')
    await processConversation(deps(llm, wa), conv)
    expect(ultimoTexto(wa)).toBe('Pronto, cancelei seu pedido de evento: Asa Sul, terça-feira (20/10).')
    const [p] = await pedidos()
    expect(p!.status).toBe('cancelado')
    expect((await acoesAudit()).map((a) => a.acao)).toEqual(['evento.pedido_criado', 'evento.pedido_cancelado'])
  })

  it('cliente B não cancela o pedido do cliente A', async () => {
    const { restaurantId } = await setup()
    const convA = await receive(restaurantId, 'aniversário pra 40 na asa sul dia 20/10')
    const wa = fakeWa()
    await processConversation(deps(fakeLlm([triagem(ev(COMPLETO))]).llm, wa), convA)
    const [pA] = await pedidos()

    const convB = await receive(restaurantId, 'cancela o pedido de evento', null, 'bia')
    await processConversation(deps(fakeLlm([triagem(cancelarEv())]).llm, wa), convB)
    expect(ultimoTexto(wa)).toBe('Não encontrei pedido de evento seu em andamento.')

    // defeito simulado: o pedido de A chega ao commit de B ⇒ o banco recusa; a resposta não promete o cancelamento
    // e a equipe assume (mesmo caminho da corrida com a equipe, Etapa 06)
    injecao.pedidos = [{ id: pA!.id, unitId: pA!.unitId, spaceId: null, data: pA!.data, convidados: 40, tipo: 'aniversario', status: 'novo' }]
    await receive(restaurantId, 'cancela o pedido de evento', null, 'bia')
    await processConversation(deps(fakeLlm([triagem(cancelarEv())]).llm, wa), convB)
    expect(ultimoTexto(wa)).toBe('Seu pedido de evento foi atualizado pela equipe. Vou chamar alguém para te ajudar.')
    expect(await pedidos()).toMatchObject([{ id: pA!.id, status: 'novo' }])
    expect((await acoesAudit()).map((a) => a.acao)).toEqual(['evento.pedido_criado', 'conversa.handoff_evento'])
    expect(await conversa(convB)).toMatchObject({ estado: 'aguardando_humano', handoffMotivo: 'servico' })
  })

  it('cancelar pedido confirmado ⇒ handoff (aguardando_humano), mensagem entregue, pedido intacto', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'aniversário pra 40 na asa sul dia 20/10')
    const { llm } = fakeLlm([triagem(ev(COMPLETO)), triagem(cancelarEv())])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    await db.update(schema.eventRequests).set({ status: 'confirmado' })
    await receive(restaurantId, 'quero cancelar o evento')
    await processConversation(deps(llm, wa), conv)
    expect(ultimoTexto(wa)).toBe('Esse evento já foi confirmado pela equipe. Vou chamar um atendente para te ajudar.')
    const c = await conversa(conv)
    expect(c.estado).toBe('aguardando_humano')
    expect(c.pendente).toBeNull()
    expect(await pedidos()).toMatchObject([{ status: 'confirmado' }])
    expect((await acoesAudit()).map((a) => [a.acao, a.entidade])).toEqual([
      ['evento.pedido_criado', 'event_request'],
      ['conversa.handoff_evento', 'conversation'],
    ])
  })

  it('conversa simulada grava o pedido com simulado = true', async () => {
    const { restaurantId } = await setup()
    const dono = await seedStaff(db, sql, { restaurantId, papel: 'dono' })
    const { conversationId } = await abrirSimulacao(db, { restaurantId, userId: dono })
    await enviarMensagemSimulada(db, { restaurantId, userId: dono, conversationId, texto: 'aniversário pra 40 dia 20/10' }, noopEnqueue)
    const proibido = {
      async sendText(): Promise<never> { throw new Error('Meta chamada em simulação') },
      async sendLocation(): Promise<never> { throw new Error('Meta chamada em simulação') },
      async sendList(): Promise<never> { throw new Error('Meta chamada em simulação') },
    }
    await processConversation(deps(fakeLlm([triagem(ev(COMPLETO))]).llm, proibido), conversationId)
    expect(await pedidos()).toMatchObject([{ convidados: 40, simulado: true, status: 'novo' }])
  })

  it('humano assume antes do commit ⇒ nenhum pedido gravado', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'aniversário pra 40 na asa sul dia 20/10')
    const { llm } = fakeLlm([triagem(ev(COMPLETO))], async () => {
      await db.update(schema.conversations).set({ estado: 'humano' }).where(eq(schema.conversations.id, conv))
    })
    expect(await processConversation(deps(llm, fakeWa()), conv)).toBe('human_state')
    expect(await pedidos()).toHaveLength(0)
    expect(await acoesAudit()).toHaveLength(0)
  })

  it('lista de unidades aberta por pedido de evento vale 60 minutos (a do S1 segue com 30)', async () => {
    const { restaurantId } = await setup(4)
    const conv = await receive(restaurantId, 'quero fazer um evento')
    await processConversation(deps(fakeLlm([triagem(ev())]).llm, fakeWa()), conv)
    expect((await conversa(conv)).pendente).toMatchObject({ tipo: 'unidade', expiraEm: '2026-10-05T18:00:00.000Z' })
    const conv2 = await receive(restaurantId, 'que horas abre?', null, 'bia')
    const s1 = ev({ servico: 'horario_unidades', tipo: 'horario_dia', data: 'hoje' })
    await processConversation(deps(fakeLlm([triagem(s1)]).llm, fakeWa()), conv2)
    expect((await conversa(conv2)).pendente).toMatchObject({ tipo: 'unidade', expiraEm: '2026-10-05T17:30:00.000Z' })
  })

  it('pendente de evento vencido: a triagem roda sem a pergunta pendente', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'quero fazer um evento na asa sul')
    const { llm, calls } = fakeLlm([triagem(ev({ unidade: 'asa sul' })), triagem()])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    expect((await conversa(conv)).pendente).toMatchObject({ tipo: 'pedido_evento', campo: 'data' })
    const p = (await conversa(conv)).pendente as Record<string, unknown>
    await db.update(schema.conversations).set({ pendente: { ...p, expiraEm: '2026-10-05T16:00:00.000Z' } })
    await receive(restaurantId, 'dia 20')
    await processConversation(deps(llm, wa), conv)
    expect(calls[1]).not.toContain('<pergunta_pendente>')
  })

  it('pendente da reserva (S2) também vai à triagem com a pergunta e o que já se sabe (horário normalizado)', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'vou hoje lá pelas 20h')
    const av = ev({ servico: 'aviso_presenca', tipo: 'registrar', data: 'hoje', horario: 'lá pelas 20h' })
    const { llm, calls } = fakeLlm([triagem(av), triagem(av)])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    expect(ultimoTexto(wa)).toBe('Para quantas pessoas?')
    await receive(restaurantId, 'eu e a família')
    await processConversation(deps(llm, wa), conv)
    expect(calls[1]).toContain('<pergunta_pendente>\nPara quantas pessoas?\n</pergunta_pendente>')
    expect(calls[1]).toContain('{"servico":"aviso_presenca","unidade":"Asa Sul","data":"2026-10-05","horario":"20:00"}')
  })
})

describe('S3 no worker — correções da homologação (Etapa 05)', () => {
  async function comPedido(status: 'novo' | 'confirmado', spaceId: string | null = null) {
    const { restaurantId, ids, espaco } = await setup()
    const conv = await receive(restaurantId, 'oi')
    const { customerId } = await conversa(conv)
    const [p] = await db.insert(schema.eventRequests).values({
      restaurantId, customerId, unitId: ids['Asa Sul']!, spaceId, data: '2026-10-20', convidados: 40, tipo: 'aniversario',
      status, observacoes: 'Bolo sem glúten', nome: 'Maria',
    }).returning()
    // o "oi" só criou a conversa e o cliente: o teste manda a próxima mensagem
    await db.delete(schema.messages).where(eq(schema.messages.conversationId, conv))
    return { restaurantId, ids, espaco, conv, pedido: p! }
  }

  it('mudança num pedido em andamento ⇒ aguardando humano + observação no pedido (sem novo pedido), auditado', async () => {
    const { restaurantId, conv, pedido } = await comPedido('novo')
    await receive(restaurantId, 'na verdade vão ser 60 pessoas')
    const { llm } = fakeLlm([triagem(ev({ tema: 'mudanca', convidados: 60 }))])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    expect(ultimoTexto(wa)).toBe('Anotei o que você pediu e vou chamar a equipe para ajustar seu pedido de evento.')
    expect((await conversa(conv)).estado).toBe('aguardando_humano')
    const todos = await pedidos()
    expect(todos).toHaveLength(1)
    expect(todos[0]).toMatchObject({ id: pedido.id, convidados: 40, status: 'novo', observacoes: 'Bolo sem glúten\nCliente pediu: 60 convidados' })
    expect(await acoesAudit()).toEqual([
      { acao: 'evento.pedido_observado', entidade: 'event_request', atorTipo: 'ia', entidadeId: pedido.id },
      { acao: 'conversa.handoff_evento', entidade: 'conversation', atorTipo: 'sistema', entidadeId: conv },
    ])
  })

  it('o espaço do pedido vem do banco: citar o mesmo espaço não é mudança; outro espaço é', async () => {
    const { restaurantId, conv, espaco } = await comPedido('novo', null)
    await db.update(schema.eventRequests).set({ spaceId: espaco['Salão'] })
    await receive(restaurantId, 'pedido no salão dia 20/10 pra 40, aniversário')
    const { llm } = fakeLlm([
      triagem(ev({ ...COMPLETO, espaco: 'salão' })),
      triagem(ev({ ...COMPLETO, espaco: 'varanda', convidados: 20 })),
    ])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    expect((await conversa(conv)).estado).toBe('ia')
    expect((await pedidos())[0]!.observacoes).toBe('Bolo sem glúten')
    await receive(restaurantId, 'melhor na varanda, 20 pessoas')
    await processConversation(deps(llm, wa), conv)
    expect((await conversa(conv)).estado).toBe('aguardando_humano')
    expect((await pedidos())[0]!.observacoes).toBe('Bolo sem glúten\nCliente pediu: 20 convidados, espaço Varanda')
  })

  it('pedido já confirmado no dia ⇒ handoff, sem novo pedido nem observação', async () => {
    const { restaurantId, conv } = await comPedido('confirmado')
    await receive(restaurantId, 'quero um aniversário pra 40 na asa sul dia 20/10')
    const { llm } = fakeLlm([triagem(ev(COMPLETO))])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    expect((await conversa(conv)).estado).toBe('aguardando_humano')
    const todos = await pedidos()
    expect(todos).toHaveLength(1)
    expect(todos[0]).toMatchObject({ status: 'confirmado', observacoes: 'Bolo sem glúten' })
    expect((await acoesAudit()).map((a) => a.acao)).toEqual(['conversa.handoff_evento'])
  })
})

describe('S3 no worker — pendências da Etapa 04 (Etapa 06)', () => {
  it('pendência 2: reserva + evento na mesma mensagem ⇒ terminada a reserva, pergunta o que falta do evento', async () => {
    const { restaurantId, ids } = await setup()
    const conv = await receive(restaurantId, 'reserva hoje na asa sul às 20h em nome de Maria e quero fazer um aniversário lá dia 20/10')
    const aviso = ev({ servico: 'aviso_presenca', tipo: 'registrar', unidade: 'asa sul', data: 'hoje', horario: '20h', nome: 'Maria' })
    const { llm, calls } = fakeLlm([triagem(aviso, ev({ unidade: 'asa sul', data: '20/10', tipoEvento: 'aniversário' }))])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    expect(ultimoTexto(wa)).toMatch(/Para quantas pessoas\?$/)
    expect((await conversa(conv)).pendente).toMatchObject({
      tipo: 'reserva', campo: 'pessoas', eventoAdiado: { campo: 'convidados', unitId: ids['Asa Sul'], texto: 'Para quantos convidados?' },
    })

    await receive(restaurantId, '4')
    await processConversation(deps(llm, wa), conv)
    // a pergunta do evento continua guardada enquanto a reserva pergunta
    expect((await conversa(conv)).pendente).toMatchObject({ tipo: 'reserva', campo: 'contato', eventoAdiado: { campo: 'convidados' } })
    await receive(restaurantId, 'pode sim')
    await processConversation(deps(llm, wa), conv)
    expect(calls).toHaveLength(1) // respostas curtas sem LLM
    expect(ultimoTexto(wa)).toMatch(/4 pessoas[\s\S]*\n\nPara quantos convidados\?$/)
    expect(await db.select().from(schema.attendanceNotices)).toHaveLength(1)
    expect((await conversa(conv)).pendente).toMatchObject({
      tipo: 'pedido_evento', campo: 'convidados', unitId: ids['Asa Sul'], item: { data: '2026-10-20', tipoEvento: 'aniversário' },
    })
  })

  it('pendência 2: adiada pela lista de unidade de outro item ⇒ retomada depois da escolha', async () => {
    const { restaurantId, ids } = await setup(4)
    const conv = await receive(restaurantId, 'vou sábado e quero um aniversário na asa sul dia 20/10')
    const aviso = ev({ servico: 'aviso_presenca', tipo: 'registrar', data: 'sábado', pessoas: 4, horario: '13h', nome: 'Maria' })
    const { llm } = fakeLlm([triagem(aviso, ev({ unidade: 'asa sul', data: '20/10', tipoEvento: 'aniversário' }))])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    expect((await conversa(conv)).pendente).toMatchObject({ tipo: 'unidade', eventoAdiado: { campo: 'convidados' } })
    await receive(restaurantId, 'Lago Sul', ids['Lago Sul']!)
    await processConversation(deps(llm, wa), conv)
    // a reserva pergunta o contato (um dado por vez); depois dela, a pergunta do evento
    expect(ultimoTexto(wa)).toBe('Posso usar este número do WhatsApp para falar com você sobre a reserva?')
    await receive(restaurantId, 'sim')
    await processConversation(deps(llm, wa), conv)
    expect(ultimoTexto(wa)).toMatch(/\n\nPara quantos convidados\?$/)
    expect((await conversa(conv)).pendente).toMatchObject({ tipo: 'pedido_evento', campo: 'convidados', unitId: ids['Asa Sul'] })
  })

  it('pendência 3: toque numa lista antiga com pendente pedido_evento usa a unidade tocada (antes: "lista expirada")', async () => {
    const { restaurantId, ids } = await setup(4)
    const conv = await receive(restaurantId, 'quero fazer um evento dia 20/10 pra 40')
    const { llm, calls } = fakeLlm([triagem(ev({ data: '20/10', convidados: 40 }))])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    await receive(restaurantId, 'Asa Sul', ids['Asa Sul']!)
    await processConversation(deps(llm, wa), conv)
    expect((await conversa(conv)).pendente).toMatchObject({ tipo: 'pedido_evento', campo: 'tipo', unitId: ids['Asa Sul'] })

    await receive(restaurantId, 'Asa Norte', ids['Asa Norte']!)
    await processConversation(deps(llm, wa), conv)
    expect(calls).toHaveLength(1)
    expect(ultimoTexto(wa)).not.toMatch(/lista expirou/)
    expect((await conversa(conv)).pendente).toMatchObject({
      tipo: 'pedido_evento', unitId: ids['Asa Norte'], item: { unidade: 'Asa Norte', data: '2026-10-20', convidados: 40 },
    })
    expect((await conversa(conv)).unidadeContextoId).toBe(ids['Asa Norte'])
  })

  it('pendência 3: id que não é unidade ativa ⇒ "lista expirada" como antes', async () => {
    const { restaurantId, ids } = await setup(4)
    const conv = await receive(restaurantId, 'quero fazer um evento na asa sul')
    const wa = fakeWa()
    await processConversation(deps(fakeLlm([triagem(ev({ unidade: 'asa sul' }))]).llm, wa), conv)
    expect((await conversa(conv)).pendente).toMatchObject({ tipo: 'pedido_evento', campo: 'data' })
    await db.update(schema.units).set({ ativo: false }).where(eq(schema.units.id, ids['Asa Norte']!))
    await receive(restaurantId, 'Asa Norte', ids['Asa Norte']!)
    await processConversation(deps(fakeLlm([]).llm, wa), conv)
    expect(ultimoTexto(wa)).toBe('Essa lista expirou. Pode me mandar a pergunta de novo?')
  })

  it.each(['recusado', 'cancelado'] as const)('a equipe marca o pedido como %s durante a resposta ⇒ texto neutro (nunca "confirmado") e passa para a equipe', async (status) => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'aniversário pra 40 na asa sul dia 20/10')
    const wa = fakeWa()
    await processConversation(deps(fakeLlm([triagem(ev(COMPLETO))]).llm, wa), conv)
    const [p] = await pedidos()
    injecao.pedidos = [{ id: p!.id, unitId: p!.unitId, spaceId: null, data: p!.data, convidados: 40, tipo: 'aniversario', status: 'novo' }]
    await db.update(schema.eventRequests).set({ status })
    await receive(restaurantId, 'quero cancelar o evento')
    await processConversation(deps(fakeLlm([triagem(cancelarEv())]).llm, wa), conv)
    expect(ultimoTexto(wa)).toBe('Seu pedido de evento foi atualizado pela equipe. Vou chamar alguém para te ajudar.')
    expect(await pedidos()).toMatchObject([{ status }])
    expect(await conversa(conv)).toMatchObject({ estado: 'aguardando_humano', handoffMotivo: 'servico' })
  })

  it('pendência 4: a equipe confirma o pedido durante a resposta ⇒ não cancela, avisa e passa para a equipe', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'aniversário pra 40 na asa sul dia 20/10')
    const wa = fakeWa()
    await processConversation(deps(fakeLlm([triagem(ev(COMPLETO))]).llm, wa), conv)
    const [p] = await pedidos()
    // a leitura do worker ainda vê `novo`; no banco a equipe já confirmou
    injecao.pedidos = [{ id: p!.id, unitId: p!.unitId, spaceId: null, data: p!.data, convidados: 40, tipo: 'aniversario', status: 'novo' }]
    await db.update(schema.eventRequests).set({ status: 'confirmado' })
    await receive(restaurantId, 'quero cancelar o evento')
    await processConversation(deps(fakeLlm([triagem(cancelarEv())]).llm, wa), conv)
    expect(ultimoTexto(wa)).toBe('Já temos um evento confirmado seu nesse dia. Vou chamar a equipe para te ajudar.')
    expect(await pedidos()).toMatchObject([{ status: 'confirmado' }])
    const c = await conversa(conv)
    expect(c).toMatchObject({ estado: 'aguardando_humano', handoffMotivo: 'servico', pendente: null })
    const ms = await db.select().from(schema.messages).where(eq(schema.messages.direcao, 'out')).orderBy(asc(schema.messages.id))
    expect(ms.at(-1)).toMatchObject({ autor: 'sistema', statusEnvio: 'enviado' })
    expect((await acoesAudit()).map((a) => a.acao)).toEqual(['evento.pedido_criado', 'conversa.handoff_evento'])
  })
})
