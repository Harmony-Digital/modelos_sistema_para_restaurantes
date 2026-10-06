import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import { encryptPhone, keyFromBase64 } from '@atd/core'
import { abrirSimulacao, enviarMensagemSimulada, ingestInbound, schema, type Enqueue, type EspacoS3, type PedidoAtivo } from '@atd/db'
import { getTestDb, resetDb, seedRestaurant, seedStaff } from '@atd/db/test-utils'
import type * as DbModule from '@atd/db'
import type { LlmClient, TriageV4 } from '@atd/ai'
import type { SendResult } from '@atd/whatsapp'
import { createLogger } from '../logger.ts'
import { processConversation, type ProcessDeps } from './process-conversation.ts'

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

type Item = TriageV4['itens'][number]
const ev = (extra: Partial<Item> = {}): Item => ({
  servico: 'evento', tipo: 'pedido', unidade: null, data: null, tema: null, pessoas: null, horario: null,
  convidados: null, tipoEvento: null, espaco: null, ...extra,
})
const cancelarEv = (extra: Partial<Item> = {}) => ev({ tipo: 'cancelar', ...extra })
const triagem = (...itens: Item[]): TriageV4 => ({ itens, fora_escopo: false })
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

function fakeLlm(script: TriageV4[], aoChamar?: () => Promise<void>) {
  const calls: string[] = []
  const llm: LlmClient = {
    async completeJson(p) {
      calls.push(p.user)
      if (aoChamar) await aoChamar()
      return {
        ok: true as const, data: p.parse(script[Math.min(calls.length - 1, script.length - 1)]), model: 'fake/m',
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

const deps = (llm: LlmClient, wa: ProcessDeps['wa']): ProcessDeps =>
  ({ db, llm, wa, phoneKey, triageModels: ['fake/m'], log, requeue: async () => undefined, now: () => SEG_14H })
const conversa = async (id: string) => (await db.select().from(schema.conversations).where(eq(schema.conversations.id, id)))[0]!
const pedidos = () => db.select().from(schema.eventRequests).orderBy(asc(schema.eventRequests.createdAt))
const ultimoTexto = (wa: ReturnType<typeof fakeWa>) => wa.enviados.at(-1)!.corpo as string
const acoesAudit = async () =>
  (await db.select({ acao: schema.auditLog.acao, entidade: schema.auditLog.entidade, atorTipo: schema.auditLog.atorTipo, entidadeId: schema.auditLog.entidadeId })
    .from(schema.auditLog).orderBy(asc(schema.auditLog.id)))
    .filter((a) => a.acao.startsWith('evento.') || a.acao.startsWith('conversa.'))

describe('S3 no worker', () => {
  it('pedido completo numa mensagem ⇒ "Recebemos seu pedido…", linha novo, triage-v4 e audit_log', async () => {
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
      tipoTexto: 'aniversário', status: 'novo', nome: 'Maria', simulado: false,
    })
    expect(p!.customerId).toBe((await conversa(conv)).customerId)
    const [run] = await db.select().from(schema.aiRuns)
    expect(run).toMatchObject({ promptVersion: 'triage-v4', intent: 'evento:pedido', itensValidos: 1, itensRespondidos: 1 })
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
    expect(calls[1]).toContain('<pedido_em_andamento>\n{"unidade":"Asa Norte"}\n</pedido_em_andamento>')
    expect(calls[1]).toContain('<mensagem_cliente>\ndia 20\n</mensagem_cliente>')
    expect(ultimoTexto(wa)).toBe('Para quantos convidados?')

    await receive(restaurantId, 'uns 40')
    await processConversation(deps(llm, wa), conv)
    expect(calls[2]).toContain('<pergunta_pendente>\nPara quantos convidados?\n</pergunta_pendente>')
    expect(calls[2]).toContain('{"unidade":"Asa Norte","data":"2026-10-20"}')
    expect(ultimoTexto(wa)).toBe('Qual o tipo do evento? (aniversário, casamento, corporativo, confraternização…)')
    expect(await pedidos()).toHaveLength(0)

    await receive(restaurantId, 'aniversário')
    await processConversation(deps(llm, wa), conv)
    expect(calls).toHaveLength(4)
    expect(calls[3]).toContain('{"unidade":"Asa Norte","data":"2026-10-20","convidados":40}')
    expect(ultimoTexto(wa)).toMatch(/^Recebemos seu pedido de aniversário para 40 convidados na unidade Asa Norte, /)
    expect(await pedidos()).toMatchObject([{ unitId: ids['Asa Norte'], data: '2026-10-20', convidados: 40, tipo: 'aniversario', status: 'novo' }])
    expect((await conversa(conv)).pendente).toBeNull()
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
    expect(calls[1]).toContain('{"unidade":"Asa Sul","data":"2026-10-20","convidados":40,"tipo":"aniversário"}')
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
    expect(calls[1]).toContain('{"unidade":"Asa Sul","convidados":40,"tipo":"outro"}')
    expect(calls[1]).not.toMatch(/formatura|sal[aã]o/i)
    expect(ultimoTexto(wa)).toMatch(/^Recebemos seu pedido de formatura para 40 convidados na unidade Asa Sul, .*, no espaço Salão\./)
    expect(await pedidos()).toMatchObject([{ tipo: 'outro', tipoTexto: 'formatura', spaceId: espaco['Salão'] }])
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

    // defeito simulado: o pedido de A chega ao commit de B ⇒ o banco recusa e a resposta diz o que ele fez
    injecao.pedidos = [{ id: pA!.id, unitId: pA!.unitId, data: pA!.data, convidados: 40, tipo: 'aniversario', status: 'novo' }]
    await receive(restaurantId, 'cancela o pedido de evento', null, 'bia')
    await processConversation(deps(fakeLlm([triagem(cancelarEv())]).llm, wa), convB)
    expect(ultimoTexto(wa)).toBe('Não encontrei pedido de evento seu em andamento.')
    expect(await pedidos()).toMatchObject([{ id: pA!.id, status: 'novo' }])
    expect((await acoesAudit()).map((a) => a.acao)).toEqual(['evento.pedido_criado'])
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

  it('pendente de pessoas (S2) também vai à triagem v4 com a pergunta e o que já se sabe', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'vou hoje')
    const av = ev({ servico: 'aviso_presenca', tipo: 'registrar' })
    const { llm, calls } = fakeLlm([triagem(av), triagem(av)])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    expect(ultimoTexto(wa)).toBe('Para quantas pessoas?')
    await receive(restaurantId, 'eu e a família')
    await processConversation(deps(llm, wa), conv)
    expect(calls[1]).toContain('<pergunta_pendente>\nPara quantas pessoas?\n</pergunta_pendente>')
    expect(calls[1]).toContain('{"unidade":"Asa Sul","data":"2026-10-05"}')
  })
})
