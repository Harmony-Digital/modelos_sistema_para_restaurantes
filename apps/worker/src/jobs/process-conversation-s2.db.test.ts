import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, asc, eq } from 'drizzle-orm'
import { encryptPhone, keyFromBase64 } from '@atd/core'
import { abrirSimulacao, enviarMensagemSimulada, ingestInbound, schema, type Enqueue } from '@atd/db'
import { getTestDb, resetDb, seedRestaurant, seedStaff } from '@atd/db/test-utils'
import type * as DbModule from '@atd/db'
import type { LlmClient, TriageV5 } from '@atd/ai'
import type { SendResult } from '@atd/whatsapp'
import { createLogger } from '../logger.ts'
import { comMidiaProibida, storageProibido } from './midia-fake.ts'
import { processConversation, type ProcessDeps } from './process-conversation.ts'

// defeito simulado: a leitura dos avisos devolve avisos de outro cliente (testa a guarda do commit)
const injecao = vi.hoisted(() => ({ avisos: null as null | { id: string; unitId: string; data: string; pessoas: number; horarioAprox: string | null }[] }))
vi.mock('@atd/db', async (importOriginal) => {
  const orig = await importOriginal<typeof DbModule>()
  return {
    ...orig,
    avisosAtivosDoCliente: (...args: Parameters<typeof orig.avisosAtivosDoCliente>) =>
      injecao.avisos ? Promise.resolve(injecao.avisos) : orig.avisosAtivosDoCliente(...args),
  }
})

const { db, sql } = getTestDb()
beforeEach(() => {
  injecao.avisos = null
  return resetDb(sql)
})
afterAll(() => sql.end())

const phoneKey = keyFromBase64(Buffer.alloc(32, 7).toString('base64'))
const noopEnqueue: Enqueue = async () => undefined
const log = createLogger('silent')
const SEG_14H = new Date('2026-10-05T14:00:00-03:00')

type Item = TriageV5['itens'][number]
const av = (extra: Partial<Item> = {}): Item =>
  ({ servico: 'aviso_presenca', tipo: 'registrar', unidade: null, data: null, tema: null, pessoas: null, horario: null, convidados: null, tipoEvento: null, espaco: null, consulta: null, tag: null, ...extra }) as Item
const cancelar = (extra: Partial<Item> = {}) => av({ tipo: 'cancelar', ...extra })
const triagem = (...itens: Item[]): TriageV5 => ({ itens, fora_escopo: false })

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
  return { restaurantId, ids }
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
        ok: true as const, data: p.parse({ frustracao: false, ...script[Math.min(calls.length - 1, script.length - 1)] }), model: 'fake/m',
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
const avisos = () => db.select().from(schema.attendanceNotices).orderBy(asc(schema.attendanceNotices.createdAt))
const ativos = async () => (await avisos()).filter((a) => a.status === 'ativo')
const ultimoTexto = (wa: ReturnType<typeof fakeWa>) => wa.enviados.at(-1)!.corpo as string
const acoesAudit = async () =>
  (await db.select({ acao: schema.auditLog.acao, entidade: schema.auditLog.entidade, atorTipo: schema.auditLog.atorTipo })
    .from(schema.auditLog).orderBy(asc(schema.auditLog.id)))
    .filter((a) => a.acao.startsWith('aviso.'))

describe('S2 no worker', () => {
  it('registra o aviso, responde "Anotado…", grava triage-v6 e audit_log', async () => {
    const { restaurantId, ids } = await setup()
    const conv = await receive(restaurantId, 'vou hoje com 4 pessoas lá pelas 20h')
    const { llm } = fakeLlm([triagem(av({ pessoas: 4, horario: '20h' }))])
    const wa = fakeWa()
    expect(await processConversation(deps(llm, wa), conv)).toBe('replied')
    expect(ultimoTexto(wa)).toMatch(/^Anotado: Asa Sul, hoje, 4 pessoas, por volta das 20h\./)
    const [a] = await avisos()
    expect(a).toMatchObject({ restaurantId, unitId: ids['Asa Sul'], data: '2026-10-05', pessoas: 4, horarioAprox: '20:00', nome: 'Maria', origem: 'ia', simulado: false, status: 'ativo' })
    const [run] = await db.select().from(schema.aiRuns)
    expect(run).toMatchObject({ promptVersion: 'triage-v6', intent: 'aviso_presenca:registrar', itensValidos: 1, itensRespondidos: 1 })
    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.acao, 'aviso.registrado'))
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ atorTipo: 'ia', entidade: 'attendance_notice', entidadeId: a!.id, diff: null })
  })

  it('mesmo pedido de novo ⇒ "Atualizei…", uma linha ativa só', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'vou hoje com 4')
    const { llm } = fakeLlm([triagem(av({ pessoas: 4 })), triagem(av({ pessoas: 6 }))])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    await receive(restaurantId, 'na verdade seremos 6 hoje')
    await processConversation(deps(llm, wa), conv)
    expect(ultimoTexto(wa)).toBe('Atualizei seu aviso: Asa Sul, hoje, 6 pessoas.')
    const lista = await ativos()
    expect(lista).toHaveLength(1)
    expect(lista[0]!.pessoas).toBe(6)
    expect((await acoesAudit()).map((a) => a.acao)).toEqual(['aviso.registrado', 'aviso.atualizado'])
  })

  it('sem pessoas ⇒ "Para quantas pessoas?" e pendente pessoas; "4" registra sem chamar o LLM', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'vou hoje à noite')
    const { llm, calls } = fakeLlm([triagem(av({ horario: 'à noite' }))])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    expect(ultimoTexto(wa)).toBe('Para quantas pessoas?')
    expect(await avisos()).toHaveLength(0)
    expect((await conversa(conv)).pendente).toMatchObject({
      tipo: 'pessoas', item: { servico: 'aviso_presenca', unidade: 'Asa Sul', data: '2026-10-05', pessoas: null, horario: 'à noite' },
    })

    await receive(restaurantId, '4')
    await processConversation(deps(llm, wa), conv)
    expect(calls).toHaveLength(1)
    expect(ultimoTexto(wa)).toMatch(/^Anotado: Asa Sul, hoje, 4 pessoas, à noite\./)
    expect(await ativos()).toHaveLength(1)
    expect((await conversa(conv)).pendente).toBeNull()
    const runs = await db.select().from(schema.aiRuns).orderBy(asc(schema.aiRuns.id))
    expect(runs.at(-1)).toMatchObject({
      etapa: 'resposta', modelo: 'deterministico', promptVersion: 's2-pessoas', costUsd: '0.000000', itensValidos: 1, itensRespondidos: 1,
    })
  })

  it('"somos 80" ao "Para quantas pessoas?": responde o limite sem LLM e não guarda pendente', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'vou hoje')
    const { llm, calls } = fakeLlm([triagem(av())])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    await receive(restaurantId, 'somos 80')
    await processConversation(deps(llm, wa), conv)
    expect(calls).toHaveLength(1)
    expect(ultimoTexto(wa)).toBe('Consigo anotar avisos de 1 a 60 pessoas. Para grupos maiores, fale com a nossa equipe.')
    expect(await avisos()).toHaveLength(0)
    expect((await conversa(conv)).pendente).toBeNull()
  })

  it('triagem com 80 pessoas: responde o limite (não vira saída inválida nem handoff)', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'vamos em 80 hoje')
    const { llm, calls } = fakeLlm([triagem(av({ pessoas: 80 }))])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    expect(calls).toHaveLength(1)
    expect(ultimoTexto(wa)).toBe('Consigo anotar avisos de 1 a 60 pessoas. Para grupos maiores, fale com a nossa equipe.')
    expect((await conversa(conv)).estado).toBe('ia')
    expect(await avisos()).toHaveLength(0)
  })

  it.each(['eu e a família', 'dia 12', '2 da tarde'])('"%s" ao "Para quantas pessoas?" vai à triagem, sem gravar número', async (resposta) => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'vou hoje')
    const { llm, calls } = fakeLlm([triagem(av()), triagem(av())])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    await receive(restaurantId, resposta)
    await processConversation(deps(llm, wa), conv)
    expect(calls).toHaveLength(2)
    expect(await avisos()).toHaveLength(0)
  })

  it('resposta de pessoas usa o id da unidade guardado (unidade renomeada no meio não reabre a lista)', async () => {
    const { restaurantId, ids } = await setup(4)
    const conv = await receive(restaurantId, 'vou na asa norte hoje')
    const { llm, calls } = fakeLlm([triagem(av({ unidade: 'asa norte' }))])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    expect((await conversa(conv)).pendente).toMatchObject({ tipo: 'pessoas', unitId: ids['Asa Norte'] })
    await db.update(schema.units).set({ nome: 'Plano Piloto' }).where(eq(schema.units.id, ids['Asa Norte']!))
    await receive(restaurantId, '4')
    await processConversation(deps(llm, wa), conv)
    expect(calls).toHaveLength(1)
    expect(ultimoTexto(wa)).toMatch(/^Anotado: Plano Piloto, hoje, 4 pessoas\./)
    expect(await ativos()).toMatchObject([{ unitId: ids['Asa Norte'], pessoas: 4 }])
  })

  it('"uns 4 ou 5" não é resposta curta: chama a triagem e não registra lixo', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'vou hoje')
    const { llm, calls } = fakeLlm([triagem(av()), triagem(av())])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    await receive(restaurantId, 'uns 4 ou 5')
    await processConversation(deps(llm, wa), conv)
    expect(calls).toHaveLength(2)
    expect(await avisos()).toHaveLength(0)
    expect(ultimoTexto(wa)).toBe('Para quantas pessoas?')
  })

  it('pendente de pessoas vencido (relógio da conversa): segue a triagem', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'vou hoje')
    const { llm, calls } = fakeLlm([triagem(av()), triagem()])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    const p = (await conversa(conv)).pendente as Record<string, unknown>
    await db.update(schema.conversations).set({ pendente: { ...p, expiraEm: '2026-10-05T16:00:00.000Z' } })
    await receive(restaurantId, '4')
    await processConversation(deps(llm, wa), conv)
    expect(calls).toHaveLength(2)
    expect(await avisos()).toHaveLength(0)
  })

  it('sem unidade e com pessoas, 4 unidades ativas ⇒ lista; ao tocar, registra sem LLM', async () => {
    const { restaurantId, ids } = await setup(4)
    const conv = await receive(restaurantId, 'vou hoje com 3')
    const { llm, calls } = fakeLlm([triagem(av({ pessoas: 3 }))])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    expect(wa.enviados.at(-1)!.tipo).toBe('lista')
    expect((await conversa(conv)).pendente).toMatchObject({ opcoes: expect.any(Array), itens: [av({ pessoas: 3 })] })
    await receive(restaurantId, 'Selecionado', ids['Lago Sul']!)
    await processConversation(deps(llm, wa), conv)
    expect(calls).toHaveLength(1)
    expect(ultimoTexto(wa)).toMatch(/^Anotado: Lago Sul, hoje, 3 pessoas\./)
    expect((await ativos()).map((a) => a.unitId)).toEqual([ids['Lago Sul']])
  })

  it('cadeia: sem unidade e sem pessoas ⇒ lista ⇒ toque ⇒ "Para quantas pessoas?" ⇒ "4" ⇒ registra (sem LLM nas três últimas)', async () => {
    const { restaurantId, ids } = await setup(4)
    const conv = await receive(restaurantId, 'vou aí hoje')
    const { llm, calls } = fakeLlm([triagem(av())])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    expect(wa.enviados.at(-1)!.tipo).toBe('lista')

    await receive(restaurantId, 'Selecionado', ids['Asa Norte']!)
    await processConversation(deps(llm, wa), conv)
    expect(ultimoTexto(wa)).toBe('Para quantas pessoas?')
    expect((await conversa(conv)).pendente).toMatchObject({ tipo: 'pessoas', item: { unidade: 'Asa Norte', data: '2026-10-05' } })

    await receive(restaurantId, '4')
    await processConversation(deps(llm, wa), conv)
    expect(calls).toHaveLength(1)
    expect(ultimoTexto(wa)).toMatch(/^Anotado: Asa Norte, hoje, 4 pessoas\./)
    expect(await ativos()).toMatchObject([{ unitId: ids['Asa Norte'], pessoas: 4, data: '2026-10-05' }])
    expect((await conversa(conv)).pendente).toBeNull()
  })

  it('pendente antigo sem `tipo` (antes da Etapa 03) continua sendo lido como lista de unidade', async () => {
    const { restaurantId, ids } = await setup(4)
    const conv = await receive(restaurantId, 'estão abertos agora?')
    const legado = {
      pergunta: 'estão abertos agora?',
      itens: [{ servico: 'horario_unidades', tipo: 'aberto_agora', unidade: null, data: null, tema: null }],
      opcoes: Object.values(ids), expiraEm: '2026-10-05T17:30:00.000Z',
    }
    await db.update(schema.conversations).set({ pendente: legado })
    const { llm, calls } = fakeLlm([])
    const wa = fakeWa()
    await db.delete(schema.messages)
    await receive(restaurantId, 'Selecionado', ids['Asa Norte']!)
    await processConversation(deps(llm, wa), conv)
    expect(calls).toHaveLength(0)
    expect(ultimoTexto(wa)).toBe('A unidade Asa Norte está aberta agora e fecha às 23h.')
  })

  it('cancela o próprio aviso e registra no audit_log', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'vou hoje com 2')
    const { llm } = fakeLlm([triagem(av({ pessoas: 2 })), triagem(cancelar())])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    await receive(restaurantId, 'não vou mais')
    await processConversation(deps(llm, wa), conv)
    expect(ultimoTexto(wa)).toBe('Pronto, cancelei seu aviso: Asa Sul, hoje.')
    expect(await ativos()).toHaveLength(0)
    expect((await avisos())[0]!.status).toBe('cancelado')
    expect(await acoesAudit()).toEqual([
      { acao: 'aviso.registrado', entidade: 'attendance_notice', atorTipo: 'ia' },
      { acao: 'aviso.cancelado', entidade: 'attendance_notice', atorTipo: 'ia' },
    ])
  })

  it('cliente B não cancela o aviso do cliente A', async () => {
    const { restaurantId } = await setup()
    const convA = await receive(restaurantId, 'vou hoje com 2')
    const wa = fakeWa()
    await processConversation(deps(fakeLlm([triagem(av({ pessoas: 2 }))]).llm, wa), convA)
    const [avisoA] = await avisos()

    const convB = await receive(restaurantId, 'cancela o aviso', null, 'bia')
    await processConversation(deps(fakeLlm([triagem(cancelar())]).llm, wa), convB)
    expect(ultimoTexto(wa)).toBe('Não encontrei nenhum aviso ativo seu.')

    // defeito simulado: o id do aviso de A chega ao commit de B ⇒ o banco recusa
    injecao.avisos = [{ id: avisoA!.id, unitId: avisoA!.unitId, data: avisoA!.data, pessoas: 2, horarioAprox: null }]
    await receive(restaurantId, 'cancela o aviso', null, 'bia')
    await processConversation(deps(fakeLlm([triagem(cancelar())]).llm, wa), convB)
    expect(await ativos()).toMatchObject([{ id: avisoA!.id, status: 'ativo' }])
    // a resposta reflete o que o banco fez: nada foi cancelado
    expect(ultimoTexto(wa)).toBe('Não encontrei nenhum aviso ativo seu.')
    expect((await acoesAudit()).map((a) => a.acao)).toEqual(['aviso.registrado'])
  })

  it('conversa simulada grava o aviso com simulado = true', async () => {
    const { restaurantId } = await setup()
    const dono = await seedStaff(db, sql, { restaurantId, papel: 'dono' })
    const { conversationId } = await abrirSimulacao(db, { restaurantId, userId: dono })
    await enviarMensagemSimulada(db, { restaurantId, userId: dono, conversationId, texto: 'vou hoje com 5' }, noopEnqueue)
    const proibido = {
      async sendText(): Promise<never> { throw new Error('Meta chamada em simulação') },
      async sendLocation(): Promise<never> { throw new Error('Meta chamada em simulação') },
      async sendList(): Promise<never> { throw new Error('Meta chamada em simulação') },
    }
    await processConversation(deps(fakeLlm([triagem(av({ pessoas: 5 }))]).llm, proibido), conversationId)
    expect(await avisos()).toMatchObject([{ pessoas: 5, simulado: true, status: 'ativo' }])
  })

  it('humano assume antes do commit ⇒ nenhum aviso gravado', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'vou hoje com 4')
    const { llm } = fakeLlm([triagem(av({ pessoas: 4 }))], async () => {
      await db.update(schema.conversations).set({ estado: 'humano' }).where(eq(schema.conversations.id, conv))
    })
    expect(await processConversation(deps(llm, fakeWa()), conv)).toBe('human_state')
    expect(await avisos()).toHaveLength(0)
    expect(await acoesAudit()).toHaveLength(0)
  })

  it('S1 e S2 na mesma mensagem: responde o horário e registra o aviso', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'que horas fecha hoje? vou com 2')
    const h = { servico: 'horario_unidades', tipo: 'horario_dia', unidade: null, data: 'hoje', tema: null, pessoas: null, horario: null, convidados: null, tipoEvento: null, espaco: null, consulta: null, tag: null } as Item
    const { llm } = fakeLlm([triagem(h, av({ pessoas: 2 }))])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    const texto = ultimoTexto(wa)
    expect(texto).toContain('11h às 23h')
    expect(texto).toContain('Anotado: Asa Sul, hoje, 2 pessoas')
    const [ativo] = await ativos()
    expect(ativo).toBeDefined()
    const audit = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.acao, 'aviso.registrado'), eq(schema.auditLog.entidadeId, ativo!.id)))
    expect(audit).toHaveLength(1)
  })
})
