import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import { encryptPhone, keyFromBase64 } from '@atd/core'
import { ingestInbound, schema, type Enqueue } from '@atd/db'
import { getTestDb, resetDb, seedRestaurant } from '@atd/db/test-utils'
import type { LlmClient, TriageV6 } from '@atd/ai'
import type { SendResult } from '@atd/whatsapp'
import { createLogger } from '../logger.ts'
import { comMidiaProibida, storageProibido } from './midia-fake.ts'
import { processConversation, type ProcessDeps } from './process-conversation.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const phoneKey = keyFromBase64(Buffer.alloc(32, 9).toString('base64'))
const noopEnqueue: Enqueue = async () => undefined
const log = createLogger('silent')
/** segunda-feira, 05/10/2026 */
const SEG_14H = new Date('2026-10-05T14:00:00-03:00')
const SEG_20H = new Date('2026-10-05T20:00:00-03:00')

const DENTRO = 'Vou passar você para alguém da nossa equipe. Já já te respondem por aqui.'
const FORA_AMANHA_9H = 'Vou passar você para alguém da nossa equipe. Nossa equipe atende amanhã a partir das 9h e te responde assim que voltar.'
const FRUSTRACAO = 'Desculpe pelo transtorno. Vou chamar alguém da nossa equipe para continuar com você.'
const QUATRO = ['Asa Norte', 'Lago Sul', 'Águas Claras']
const COMERCIAL = { dias: Object.fromEntries(['seg', 'ter', 'qua', 'qui', 'sex'].map((d) => [d, [{ inicio: '09:00', fim: '18:00' }]])) }

type Item = TriageV6['itens'][number]
const h = (tipo: string, extra: Partial<Item> = {}): Item => ({
  servico: 'horario_unidades', tipo, unidade: null, data: null, tema: null, pessoas: null, horario: null,
  convidados: null, tipoEvento: null, espaco: null, consulta: null, tag: null, ...extra,
}) as Item
const triagem = (itens: Item[], frustracao = false): TriageV6 => ({ itens, fora_escopo: itens.length === 0, frustracao })

async function setup(o: { horario?: unknown; unidades?: string[]; budget?: boolean } = {}) {
  const { restaurantId, unitId } = await seedRestaurant(db)
  await db.update(schema.restaurants).set({ nome: 'Casa Teste', horarioAtendimentoHumano: o.horario ?? {} })
  const ids: Record<string, string> = { 'Asa Sul': unitId }
  for (const [i, nome] of (o.unidades ?? []).entries()) {
    const [u] = await db.insert(schema.units).values({ restaurantId, nome, slug: `u${i}`, ordem: i + 2 }).returning()
    ids[nome] = u!.id
  }
  for (const id of Object.values(ids)) {
    for (let d = 0; d < 7; d++) await db.insert(schema.unitHours).values({ restaurantId, unitId: id, weekday: d, turno: 1, abre: '11:00', fecha: '23:00' })
  }
  if (o.budget !== false) {
    await db.insert(schema.budgetLimits).values([
      { restaurantId, escopo: 'ia', periodo: 'dia', limiteUsd: '1' },
      { restaurantId, escopo: 'ia', periodo: 'mes', limiteUsd: '10' },
    ])
  }
  return { restaurantId, ids }
}

async function receive(restaurantId: string, texto: string, interativoId: string | null = null) {
  const r = await ingestInbound(db, {
    restaurantId, waIdHash: 'hash-maria', telefoneCifrado: encryptPhone('5561999998888', phoneKey), profileName: 'Maria',
    timestamp: new Date(), wamid: `wamid.${randomUUID()}`, tipo: 'texto', texto, mediaId: null, interativoId,
  }, noopEnqueue)
  return r.conversationId
}

type Passo = TriageV6 | 'erro'
function fakeLlm(script: Passo[]) {
  const calls: string[] = []
  const llm: LlmClient = {
    async completeJson(p) {
      calls.push(p.user)
      const passo = script[Math.min(calls.length - 1, script.length - 1)]!
      if (passo === 'erro') return { ok: false as const, error: 'upstream', retryable: true, status: 502, model: null, usage: null, latencyMs: 1 }
      return {
        ok: true as const, data: p.parse(passo), model: 'fake/m',
        usage: { tokensIn: 100, tokensOut: 20, tokensCache: 0, costUsd: '0.000200' }, latencyMs: 10,
      }
    },
  }
  return { llm, calls }
}

function fakeWa() {
  const textos: string[] = []
  const ok = (): SendResult => ({ ok: true, wamid: `wamid.out.${randomUUID()}` })
  return {
    textos,
    async sendText(_to: string, texto: string) { textos.push(texto); return ok() },
    async sendLocation(_to: string, l: { nome: string; endereco: string }) { textos.push(`${l.nome}: ${l.endereco}`); return ok() },
    async sendList(_to: string, l: { corpo: string }) { textos.push(l.corpo); return ok() },
  }
}

const deps = (llm: LlmClient, wa: ReturnType<typeof fakeWa>, agora = SEG_14H): ProcessDeps =>
  ({ db, llm, wa: comMidiaProibida(wa), storage: storageProibido, phoneKey, triageModels: ['fake/m'], log, requeue: async () => undefined, now: () => agora })
const conversa = async (id: string) => (await db.select().from(schema.conversations).where(eq(schema.conversations.id, id)))[0]!
/** saídas sem o aviso de privacidade */
const saidas = async () => (await db.select().from(schema.messages).where(eq(schema.messages.direcao, 'out')).orderBy(asc(schema.messages.id)))
  .filter((m) => m.replyKey !== 'avisoPrivacidade')
const acoes = async () => (await db.select().from(schema.auditLog).orderBy(asc(schema.auditLog.id))).map((a) => a.acao)

describe('handoff no worker: motivo, espera e mensagem', () => {
  it('pedido de atendente sem horário cadastrado ⇒ handoff_dentro, motivo pedido, aguardando_desde gravado', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'quero falar com um atendente')
    const wa = fakeWa()
    await processConversation(deps(fakeLlm([]).llm, wa), conv)
    const c = await conversa(conv)
    expect(c).toMatchObject({ estado: 'aguardando_humano', handoffMotivo: 'pedido' })
    expect(c.aguardandoDesde).toBeInstanceOf(Date)
    expect(await saidas()).toMatchObject([{ autor: 'sistema', texto: DENTRO, replyKey: 'handoff_dentro', statusEnvio: 'enviado' }])
    expect(wa.textos.at(-1)).toBe(DENTRO)
    expect(await acoes()).toEqual(['conversa.handoff_pedido'])
  })

  it('fora do horário da equipe ⇒ handoff_fora com o próximo horário (fuso do restaurante)', async () => {
    const { restaurantId } = await setup({ horario: COMERCIAL })
    const conv = await receive(restaurantId, 'quero falar com um atendente')
    const wa = fakeWa()
    await processConversation(deps(fakeLlm([]).llm, wa, SEG_20H), conv)
    expect(wa.textos.at(-1)).toBe(FORA_AMANHA_9H)
    expect((await saidas()).at(-1)).toMatchObject({ replyKey: 'handoff_fora', autor: 'sistema' })
  })

  it('dentro do horário da equipe ⇒ handoff_dentro; horário inválido no banco ⇒ sem promessa (handoff_dentro)', async () => {
    const { restaurantId } = await setup({ horario: COMERCIAL })
    const conv = await receive(restaurantId, 'quero falar com um atendente')
    const wa = fakeWa()
    await processConversation(deps(fakeLlm([]).llm, wa, SEG_14H), conv)
    expect(wa.textos.at(-1)).toBe(DENTRO)

    await resetDb(sql)
    const outro = await setup({ horario: { dias: { seg: [{ inicio: '25:00', fim: '18:00' }] } } })
    const conv2 = await receive(outro.restaurantId, 'quero falar com um atendente')
    const wa2 = fakeWa()
    await processConversation(deps(fakeLlm([]).llm, wa2, SEG_20H), conv2)
    expect(wa2.textos.at(-1)).toBe(DENTRO)
  })

  it('modelo personalizado do handoff vale', async () => {
    const { restaurantId } = await setup({ horario: COMERCIAL })
    await db.insert(schema.replyTemplates).values({ restaurantId, chave: 'handoff_fora', texto: 'Voltamos {proximo_horario}. Aguarde!' })
    const conv = await receive(restaurantId, 'quero falar com um atendente')
    const wa = fakeWa()
    await processConversation(deps(fakeLlm([]).llm, wa, SEG_20H), conv)
    expect(wa.textos.at(-1)).toBe('Voltamos amanhã a partir das 9h. Aguarde!')
  })

  it('triagem pede humano ⇒ motivo pedido e mensagem do sistema entregue', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'tenho um problema com meu pedido')
    const wa = fakeWa()
    await processConversation(deps(fakeLlm([triagem([{ ...h('x'), servico: 'humano', tipo: null }])]).llm, wa), conv)
    expect(await conversa(conv)).toMatchObject({ estado: 'aguardando_humano', handoffMotivo: 'pedido' })
    expect(await saidas()).toMatchObject([{ autor: 'sistema', texto: DENTRO, statusEnvio: 'enviado' }])
  })

  it('sem orçamento ⇒ motivo economico, mensagem de handoff, sem chamar o modelo', async () => {
    const { restaurantId } = await setup({ budget: false, horario: COMERCIAL })
    const conv = await receive(restaurantId, 'que horas abre?')
    const { llm, calls } = fakeLlm([])
    const wa = fakeWa()
    await processConversation(deps(llm, wa, SEG_20H), conv)
    expect(calls).toHaveLength(0)
    expect(await conversa(conv)).toMatchObject({ estado: 'aguardando_humano', handoffMotivo: 'economico' })
    expect(wa.textos.at(-1)).toBe(FORA_AMANHA_9H)
    expect(await acoes()).toEqual(['orcamento.sem_saldo'])
  })
})

describe('handoff por falhas seguidas', () => {
  it('fora de escopo duas vezes seguidas ⇒ a segunda vira handoff (motivo falhas)', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'qual a capital da França?')
    const { llm } = fakeLlm([triagem([]), triagem([])])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    expect(await conversa(conv)).toMatchObject({ estado: 'ia', falhasConsecutivas: 1, handoffMotivo: null })
    expect(wa.textos.at(-1)).toMatch(/só consigo ajudar com assuntos do Casa Teste/)

    await receive(restaurantId, 'e quem ganhou o jogo ontem?')
    await processConversation(deps(llm, wa), conv)
    expect(await conversa(conv)).toMatchObject({ estado: 'aguardando_humano', falhasConsecutivas: 2, handoffMotivo: 'falhas' })
    expect(wa.textos.at(-1)).toBe(DENTRO)
    expect((await saidas()).map((m) => m.replyKey)).toEqual(['foraEscopo', 'handoff_dentro'])
    expect(await acoes()).toEqual(['conversa.handoff_falhas'])
  })

  it('resposta válida no meio zera a contagem', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'qual a capital da França?')
    const { llm } = fakeLlm([triagem([]), triagem([h('aberto_agora')]), triagem([])])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    await receive(restaurantId, 'vocês estão abertos?')
    await processConversation(deps(llm, wa), conv)
    expect((await conversa(conv)).falhasConsecutivas).toBe(0)
    await receive(restaurantId, 'e o jogo?')
    await processConversation(deps(llm, wa), conv)
    expect(await conversa(conv)).toMatchObject({ estado: 'ia', falhasConsecutivas: 1 })
  })

  it('cortesia sem item e sem fora de escopo ("ok, até sábado") não conta falha e responde com agradecimento', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'qual a capital da França?')
    const cortesia: TriageV6 = { itens: [], fora_escopo: false, frustracao: false }
    const { llm } = fakeLlm([triagem([]), cortesia, cortesia])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    expect((await conversa(conv)).falhasConsecutivas).toBe(1)
    await receive(restaurantId, 'ok, até sábado então')
    await processConversation(deps(llm, wa), conv)
    await receive(restaurantId, 'abraço!')
    await processConversation(deps(llm, wa), conv)
    expect(await conversa(conv)).toMatchObject({ estado: 'ia', falhasConsecutivas: 1, handoffMotivo: null })
    expect(wa.textos.at(-1)).toMatch(/^Por nada!/)
    expect(await acoes()).toEqual([])
  })

  it('resposta pronta (agradecimento) zera a contagem', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'qual a capital da França?')
    const { llm } = fakeLlm([triagem([]), triagem([])])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    await receive(restaurantId, 'obrigado')
    await processConversation(deps(llm, wa), conv)
    expect((await conversa(conv)).falhasConsecutivas).toBe(0)
    await receive(restaurantId, 'e o jogo?')
    await processConversation(deps(llm, wa), conv)
    expect(await conversa(conv)).toMatchObject({ estado: 'ia', falhasConsecutivas: 1 })
  })

  it('triagem falha (com a retentativa) ⇒ handoff motivo falhas com a mensagem de handoff', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'qual o endereço?')
    const { llm, calls } = fakeLlm(['erro', 'erro'])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    expect(calls).toHaveLength(2)
    expect(await conversa(conv)).toMatchObject({ estado: 'aguardando_humano', falhasConsecutivas: 1, handoffMotivo: 'falhas' })
    expect(wa.textos.at(-1)).toBe(DENTRO)
    expect(await acoes()).toEqual(['ia.falha_triagem'])
  })
})

describe('handoff por frustração (triagem v6)', () => {
  it('responde os itens e acrescenta o handoff; tudo do sistema e entregue (nada cancelado)', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'já perguntei 3 vezes!!! que horas abre hoje???')
    const { llm, calls } = fakeLlm([triagem([h('horario_dia', { data: 'hoje' })], true)])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    expect(calls).toHaveLength(1)
    const ms = await saidas()
    expect(ms).toHaveLength(2)
    expect(ms[0]!.texto).toMatch(/11h/)
    expect(ms[1]).toMatchObject({ texto: FRUSTRACAO, replyKey: 'handoff_frustracao' })
    expect(ms.map((m) => [m.autor, m.statusEnvio])).toEqual([['sistema', 'enviado'], ['sistema', 'enviado']])
    expect(wa.textos.slice(-2)).toEqual([ms[0]!.texto, FRUSTRACAO])
    expect(await conversa(conv)).toMatchObject({ estado: 'aguardando_humano', handoffMotivo: 'frustracao', pendente: null })
    expect(await acoes()).toEqual(['conversa.handoff_frustracao'])
  })

  it('frustração sem item respondível ⇒ só o handoff (sem "só consigo ajudar")', async () => {
    const { restaurantId } = await setup()
    const conv = await receive(restaurantId, 'que atendimento horrível')
    const wa = fakeWa()
    await processConversation(deps(fakeLlm([triagem([], true)]).llm, wa), conv)
    expect((await saidas()).map((m) => m.texto)).toEqual([FRUSTRACAO])
    expect((await conversa(conv)).handoffMotivo).toBe('frustracao')
  })

  it('frustração fora do horário ⇒ handoff_fora', async () => {
    const { restaurantId } = await setup({ horario: COMERCIAL })
    const conv = await receive(restaurantId, 'ninguém responde nada aqui')
    const wa = fakeWa()
    await processConversation(deps(fakeLlm([triagem([], true)]).llm, wa, SEG_20H), conv)
    expect(wa.textos.at(-1)).toBe(FORA_AMANHA_9H)
    expect((await conversa(conv)).handoffMotivo).toBe('frustracao')
  })

  it('frustração com lista pendente: não guarda pendente (a conversa vai para a equipe)', async () => {
    const { restaurantId } = await setup({ unidades: QUATRO })
    const conv = await receive(restaurantId, 'pela última vez: que horas abre???')
    const wa = fakeWa()
    await processConversation(deps(fakeLlm([triagem([h('aberto_agora')], true)]).llm, wa), conv)
    const c = await conversa(conv)
    expect(c).toMatchObject({ estado: 'aguardando_humano', pendente: null })
    expect((await saidas()).every((m) => m.autor === 'sistema' && m.statusEnvio === 'enviado')).toBe(true)
  })
})

describe('unidade de contexto da conversa', () => {
  it('unidade citada no S1 é gravada', async () => {
    const { restaurantId, ids } = await setup({ unidades: ['Asa Norte'] })
    const conv = await receive(restaurantId, 'que horas abre a asa norte hoje?')
    await processConversation(deps(fakeLlm([triagem([h('horario_dia', { unidade: 'asa norte', data: 'hoje' })])]).llm, fakeWa()), conv)
    expect((await conversa(conv)).unidadeContextoId).toBe(ids['Asa Norte'])
  })

  it('escolha na lista grava a unidade escolhida; pergunta sem unidade não apaga a anterior', async () => {
    const { restaurantId, ids } = await setup({ unidades: QUATRO })
    const conv = await receive(restaurantId, 'estão abertos agora?')
    const { llm } = fakeLlm([triagem([h('aberto_agora')]), triagem([])])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    expect(await conversa(conv)).toMatchObject({ unidadeContextoId: null, pendente: { tipo: 'unidade' } })
    await receive(restaurantId, 'Asa Norte', ids['Asa Norte']!)
    await processConversation(deps(llm, wa), conv)
    expect((await conversa(conv)).unidadeContextoId).toBe(ids['Asa Norte'])
    await receive(restaurantId, 'e o jogo?')
    await processConversation(deps(llm, wa), conv)
    expect((await conversa(conv)).unidadeContextoId).toBe(ids['Asa Norte'])
  })

  it('restaurante de uma unidade só: a conversa atendida fica nessa unidade', async () => {
    const { restaurantId, ids } = await setup()
    const conv = await receive(restaurantId, 'vocês estão abertos?')
    await processConversation(deps(fakeLlm([triagem([h('aberto_agora')])]).llm, fakeWa()), conv)
    expect((await conversa(conv)).unidadeContextoId).toBe(ids['Asa Sul'])
  })

  it('restaurante de uma unidade só: handoff na primeira mensagem já grava a unidade', async () => {
    const { restaurantId, ids } = await setup()
    const conv = await receive(restaurantId, 'quero falar com um atendente')
    await processConversation(deps(fakeLlm([]).llm, fakeWa()), conv)
    expect(await conversa(conv)).toMatchObject({ estado: 'aguardando_humano', unidadeContextoId: ids['Asa Sul'] })
  })

  it('várias unidades ativas: handoff sem item não escolhe unidade', async () => {
    const { restaurantId } = await setup({ unidades: ['Asa Norte'] })
    const conv = await receive(restaurantId, 'quero falar com um atendente')
    await processConversation(deps(fakeLlm([]).llm, fakeWa()), conv)
    expect(await conversa(conv)).toMatchObject({ estado: 'aguardando_humano', unidadeContextoId: null })
  })

  it('aviso de presença à espera de "quantas pessoas" grava a unidade do pendente', async () => {
    const { restaurantId, ids } = await setup({ unidades: ['Asa Norte'] })
    const conv = await receive(restaurantId, 'vou hoje na asa norte')
    const aviso = { ...h('registrar', { unidade: 'asa norte', data: 'hoje' }), servico: 'aviso_presenca' } as Item
    await processConversation(deps(fakeLlm([triagem([aviso])]).llm, fakeWa()), conv)
    const c = await conversa(conv)
    expect(c.pendente).toMatchObject({ tipo: 'pessoas' })
    expect(c.unidadeContextoId).toBe(ids['Asa Norte'])
  })
})
