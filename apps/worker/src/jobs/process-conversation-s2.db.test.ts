import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import { encryptPhone, keyFromBase64 } from '@atd/core'
import { ingestInbound, REGRAS_RESERVA_PADRAO, schema, type Enqueue } from '@atd/db'
import { getTestDb, resetDb, seedRestaurant } from '@atd/db/test-utils'
import type * as DbModule from '@atd/db'
import type { LlmClient, TriageV7 } from '@atd/ai'
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

type Item = TriageV7['itens'][number]
const av = (extra: Partial<Item> = {}): Item =>
  ({ servico: 'aviso_presenca', tipo: 'registrar', unidade: null, data: null, tema: null, pessoas: null, horario: null, convidados: null, tipoEvento: null, espaco: null, consulta: null, tag: null, nome: null, contato_ok: null, ...extra }) as Item
/** Reserva com tudo menos o "pode usar este WhatsApp?" (só vale respondendo à pergunta de contato). */
const completa = (extra: Partial<Item> = {}) => av({ data: 'hoje', horario: '20h', nome: 'Maria', ...extra })
const cancelar = (extra: Partial<Item> = {}) => av({ tipo: 'cancelar', ...extra })
const triagem = (...itens: Item[]): TriageV7 => ({ itens, fora_escopo: false, frustracao: false })
const CONTATO = 'Posso usar este número do WhatsApp para falar com você sobre a reserva?'
const feita = (resumo: string) => `Reserva feita: unidade ${resumo}.\n\n${REGRAS_RESERVA_PADRAO}`

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

function fakeLlm(script: TriageV7[], aoChamar?: () => Promise<void>) {
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

const deps = (llm: LlmClient, wa: Parameters<typeof comMidiaProibida>[0]): ProcessDeps =>
  ({ db, llm, wa: comMidiaProibida(wa), storage: storageProibido, phoneKey, triageModels: ['fake/m'], log, requeue: async () => undefined, now: () => SEG_14H })
const conversa = async (id: string) => (await db.select().from(schema.conversations).where(eq(schema.conversations.id, id)))[0]!
const avisos = () => db.select().from(schema.attendanceNotices).orderBy(asc(schema.attendanceNotices.createdAt))
const ativos = async () => (await avisos()).filter((a) => a.status === 'confirmada')
const ultimoTexto = (wa: ReturnType<typeof fakeWa>) => wa.enviados.at(-1)!.corpo as string
const acoesAudit = async () =>
  (await db.select({ acao: schema.auditLog.acao, entidade: schema.auditLog.entidade, atorTipo: schema.auditLog.atorTipo })
    .from(schema.auditLog).orderBy(asc(schema.auditLog.id)))
    .filter((a) => a.acao.startsWith('reserva.'))
/** Mensagem do cliente seguida do processamento. */
async function enviar(restaurantId: string, conv: string, llm: LlmClient, wa: ReturnType<typeof fakeWa>, texto: string, interativoId: string | null = null) {
  await receive(restaurantId, texto, interativoId)
  return processConversation(deps(llm, wa), conv)
}

describe('S2 (reserva) no worker', () => {
  it('reserva completa + "sim" ao contato: grava, responde com as regras, triage-v7 e audit_log sem PII', async () => {
    const { restaurantId, ids } = await setup()
    const conv = await receive(restaurantId, 'reserva hoje às 20h para 4 em nome de Maria')
    const { llm, calls } = fakeLlm([triagem(completa({ pessoas: 4 }))])
    const wa = fakeWa()
    expect(await processConversation(deps(llm, wa), conv)).toBe('replied')
    expect(ultimoTexto(wa)).toBe(CONTATO)
    expect(await avisos()).toHaveLength(0)
    await enviar(restaurantId, conv, llm, wa, 'sim')
    expect(calls).toHaveLength(1)
    expect(ultimoTexto(wa)).toBe(feita('Asa Sul, hoje, às 20h, 4 pessoas, em nome de Maria'))
    const [a] = await avisos()
    expect(a).toMatchObject({
      restaurantId, unitId: ids['Asa Sul'], data: '2026-10-05', pessoas: 4, horario: '20:00:00', horarioAprox: null, nome: 'Maria',
      origem: 'ia', simulado: false, status: 'confirmada', contatoCifrado: null,
    })
    const [run] = await db.select().from(schema.aiRuns)
    expect(run).toMatchObject({ promptVersion: 'triage-v7', intent: 'aviso_presenca:registrar', itensValidos: 0, itensRespondidos: 0 })
    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.acao, 'reserva.registrada'))
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ atorTipo: 'ia', entidade: 'attendance_notice', entidadeId: a!.id, diff: null })
  })

  it('mesma unidade e dia de novo ⇒ muda a reserva (uma linha só), sem perguntar o contato de novo', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'reserva hoje às 20h para 4')
    const { llm } = fakeLlm([triagem(completa({ pessoas: 4 })), triagem(av({ data: 'hoje', pessoas: 6 }))])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    await enviar(restaurantId, conv, llm, wa, 'pode sim')
    await enviar(restaurantId, conv, llm, wa, 'na verdade seremos 6 hoje')
    expect(ultimoTexto(wa)).toBe(feita('Asa Sul, hoje, às 20h, 6 pessoas, em nome de Maria'))
    const lista = await ativos()
    expect(lista).toHaveLength(1)
    expect(lista[0]!.pessoas).toBe(6)
    expect((await acoesAudit()).map((a) => a.acao)).toEqual(['reserva.registrada', 'reserva.atualizada'])
  })

  it('triagem com 80 pessoas: segue como pedido de evento (sem reserva, sem handoff de falha)', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'vamos em 80 sábado')
    const { llm, calls } = fakeLlm([triagem(av({ pessoas: 80, data: 'sábado' }))])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    expect(calls).toHaveLength(1)
    expect(ultimoTexto(wa)).toContain('Reservas vão até 60 pessoas.')
    expect((await conversa(conv)).estado).toBe('ia')
    expect(await avisos()).toHaveLength(0)
  })

  it.each(['eu e a família', 'dia 12', '2 da tarde', 'uns 4 ou 5'])('"%s" ao "Para quantas pessoas?" vai à triagem, sem gravar número', async (resposta) => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'vou hoje')
    const { llm, calls } = fakeLlm([triagem(av({ data: 'hoje' })), triagem(av())])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    expect(ultimoTexto(wa)).toBe('Para quantas pessoas?')
    await enviar(restaurantId, conv, llm, wa, resposta)
    expect(calls).toHaveLength(2)
    expect(await avisos()).toHaveLength(0)
  })

  it('resposta curta usa o id da unidade guardado (unidade renomeada no meio não reabre a lista)', async () => {
    const { restaurantId, ids } = await setup(4)
    const conv = await receive(restaurantId, 'vou na asa norte hoje')
    const { llm, calls } = fakeLlm([triagem(av({ unidade: 'asa norte', data: 'hoje' }))])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    expect((await conversa(conv)).pendente).toMatchObject({ tipo: 'reserva', campo: 'pessoas', unitId: ids['Asa Norte'] })
    await db.update(schema.units).set({ nome: 'Plano Piloto' }).where(eq(schema.units.id, ids['Asa Norte']!))
    await enviar(restaurantId, conv, llm, wa, '4')
    expect(calls).toHaveLength(1)
    expect(ultimoTexto(wa)).toBe('Para que horas é a reserva?')
    expect((await conversa(conv)).pendente).toMatchObject({ campo: 'horario', unitId: ids['Asa Norte'], item: { unidade: 'Plano Piloto', pessoas: 4 } })
  })

  it('pendente da reserva vencido (relógio da conversa): segue a triagem', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'vou hoje')
    const { llm, calls } = fakeLlm([triagem(av({ data: 'hoje' })), triagem()])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    const p = (await conversa(conv)).pendente as Record<string, unknown>
    await db.update(schema.conversations).set({ pendente: { ...p, expiraEm: '2026-10-05T16:00:00.000Z' } })
    await enviar(restaurantId, conv, llm, wa, '4')
    expect(calls).toHaveLength(2)
    expect(await avisos()).toHaveLength(0)
  })

  it('sem unidade, 4 unidades ativas ⇒ "Para qual unidade é a reserva?"; ao tocar, segue a coleta sem LLM', async () => {
    const { restaurantId, ids } = await setup(4)
    const conv = await receive(restaurantId, 'reserva hoje às 20h para 3')
    const { llm, calls } = fakeLlm([triagem(completa({ pessoas: 3 }))])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    expect(wa.enviados.at(-1)).toMatchObject({ tipo: 'lista', corpo: { corpo: 'Para qual unidade é a reserva? Toque em "Ver unidades" e escolha.' } })
    expect((await conversa(conv)).pendente).toMatchObject({ tipo: 'unidade', opcoes: expect.any(Array), itens: [completa({ pessoas: 3 })] })
    await enviar(restaurantId, conv, llm, wa, 'Selecionado', ids['Lago Sul']!)
    expect(ultimoTexto(wa)).toBe(CONTATO)
    await enviar(restaurantId, conv, llm, wa, 'sim')
    expect(calls).toHaveLength(1)
    expect(ultimoTexto(wa)).toBe(feita('Lago Sul, hoje, às 20h, 3 pessoas, em nome de Maria'))
    expect((await ativos()).map((a) => a.unitId)).toEqual([ids['Lago Sul']])
  })

  it('o "pode usar este WhatsApp" da triagem guardado na lista não vale: pergunta o contato depois do toque', async () => {
    const { restaurantId, ids } = await setup(4)
    const conv = await receive(restaurantId, 'reserva hoje às 20h para 3, pode usar esse número')
    const { llm } = fakeLlm([triagem(completa({ pessoas: 3, contato_ok: true }))])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    await enviar(restaurantId, conv, llm, wa, 'Selecionado', ids['Asa Norte']!)
    expect(ultimoTexto(wa)).toBe(CONTATO)
    expect(await avisos()).toHaveLength(0)
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
    await enviar(restaurantId, conv, llm, wa, 'Selecionado', ids['Asa Norte']!)
    expect(calls).toHaveLength(0)
    expect(ultimoTexto(wa)).toBe('A unidade Asa Norte está aberta agora e fecha às 23h.')
  })

  it('cancela a própria reserva e registra no audit_log', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'reserva hoje às 20h para 2')
    const { llm } = fakeLlm([triagem(completa({ pessoas: 2 })), triagem(cancelar())])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    await enviar(restaurantId, conv, llm, wa, 'sim')
    await enviar(restaurantId, conv, llm, wa, 'não vou mais')
    expect(ultimoTexto(wa)).toBe('Pronto, cancelei sua reserva: Asa Sul, hoje.')
    expect(await ativos()).toHaveLength(0)
    expect((await avisos())[0]!.status).toBe('cancelada')
    expect(await acoesAudit()).toEqual([
      { acao: 'reserva.registrada', entidade: 'attendance_notice', atorTipo: 'ia' },
      { acao: 'reserva.cancelada', entidade: 'attendance_notice', atorTipo: 'ia' },
    ])
  })

  it('cliente B não cancela a reserva do cliente A', async () => {
    const { restaurantId, ids } = await setup()
    const [reservaA] = await db.insert(schema.attendanceNotices).values({
      restaurantId, unitId: ids['Asa Sul']!, customerId: null, data: '2026-10-05', pessoas: 2, horario: '20:00', nome: 'A', origem: 'painel',
    }).returning()
    const wa = fakeWa()
    const convB = await receive(restaurantId, 'cancela a reserva', null, 'bia')
    await processConversation(deps(fakeLlm([triagem(cancelar())]).llm, wa), convB)
    expect(ultimoTexto(wa)).toBe('Não encontrei nenhuma reserva sua.')

    // defeito simulado: o id da reserva de A chega ao commit de B ⇒ o banco recusa
    injecao.avisos = [{ id: reservaA!.id, unitId: reservaA!.unitId, data: reservaA!.data, pessoas: 2, horarioAprox: null }]
    await receive(restaurantId, 'cancela a reserva', null, 'bia')
    await processConversation(deps(fakeLlm([triagem(cancelar())]).llm, wa), convB)
    expect(await ativos()).toMatchObject([{ id: reservaA!.id, status: 'confirmada' }])
    // a resposta reflete o que o banco fez: nada foi cancelado
    expect(ultimoTexto(wa)).toBe('Não encontrei nenhuma reserva sua.')
    expect(await acoesAudit()).toEqual([])
  })

  it('humano assume antes do commit ⇒ nenhuma reserva gravada', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'reserva hoje às 20h para 4')
    const wa = fakeWa()
    await processConversation(deps(fakeLlm([triagem(completa({ pessoas: 4 }))]).llm, wa), conv)
    const { llm } = fakeLlm([triagem(completa({ pessoas: 4, contato_ok: true }))], async () => {
      await db.update(schema.conversations).set({ estado: 'humano' }).where(eq(schema.conversations.id, conv))
    })
    await receive(restaurantId, 'sim, pode usar esse número aqui mesmo para falar comigo')
    expect(await processConversation(deps(llm, wa), conv)).toBe('human_state')
    expect(await avisos()).toHaveLength(0)
    expect(await acoesAudit()).toHaveLength(0)
  })

  it('S1 e S2 na mesma mensagem: responde o horário e pergunta o que falta da reserva', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'que horas fecha hoje? quero reservar para 2')
    const h = { servico: 'horario_unidades', tipo: 'horario_dia', unidade: null, data: 'hoje', tema: null, pessoas: null, horario: null, convidados: null, tipoEvento: null, espaco: null, consulta: null, tag: null, nome: null, contato_ok: null } as Item
    const { llm } = fakeLlm([triagem(h, av({ data: 'hoje', pessoas: 2 }))])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    const texto = ultimoTexto(wa)
    expect(texto).toContain('11h às 23h')
    expect(texto.endsWith('Para que horas é a reserva?')).toBe(true)
    expect((await conversa(conv)).pendente).toMatchObject({ tipo: 'reserva', campo: 'horario' })
  })
})
