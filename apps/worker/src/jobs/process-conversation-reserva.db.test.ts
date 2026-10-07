import { randomUUID } from 'node:crypto'
import { Writable } from 'node:stream'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import { decryptPhone, encryptPhone, keyFromBase64 } from '@atd/core'
import { abrirSimulacao, enviarMensagemSimulada, ingestInbound, REGRAS_RESERVA_PADRAO, schema, type Enqueue } from '@atd/db'
import { getTestDb, resetDb, seedRestaurant, seedStaff } from '@atd/db/test-utils'
import type * as DbModule from '@atd/db'
import type { LlmClient, TriageV7 } from '@atd/ai'
import type { SendResult } from '@atd/whatsapp'
import { createLogger } from '../logger.ts'
import { comMidiaProibida, storageProibido } from './midia-fake.ts'
import { processConversation, type ProcessDeps } from './process-conversation.ts'

// corrida simulada: algo acontece no banco depois que o worker leu a ocupação e antes do commit
const injecao = vi.hoisted(() => ({ aposLerOcupacao: null as null | (() => Promise<void>) }))
vi.mock('@atd/db', async (importOriginal) => {
  const orig = await importOriginal<typeof DbModule>()
  return {
    ...orig,
    ocupacaoDoDia: async (...args: Parameters<typeof orig.ocupacaoDoDia>) => {
      const r = await orig.ocupacaoDoDia(...args)
      const depois = injecao.aposLerOcupacao
      injecao.aposLerOcupacao = null
      if (depois) await depois()
      return r
    },
  }
})

const { db, sql } = getTestDb()
beforeEach(() => {
  injecao.aposLerOcupacao = null
  return resetDb(sql)
})
afterAll(() => sql.end())

const phoneKey = keyFromBase64(Buffer.alloc(32, 7).toString('base64'))
const noopEnqueue: Enqueue = async () => undefined
const SEG_14H = new Date('2026-10-05T14:00:00-03:00')
const HOJE = '2026-10-05'

type Item = TriageV7['itens'][number]
const nulos = {
  unidade: null, data: null, tema: null, pessoas: null, horario: null, convidados: null, tipoEvento: null, espaco: null, consulta: null,
  tag: null, nome: null, contato_ok: null,
}
const res = (extra: Partial<Item> = {}): Item => ({ servico: 'aviso_presenca', tipo: 'registrar', ...nulos, ...extra }) as Item
const triagem = (...itens: Item[]): TriageV7 => ({ itens, fora_escopo: false, frustracao: false })

const PERGUNTA_CONTATO = 'Posso usar este número do WhatsApp para falar com você sobre a reserva?'
const PERGUNTA_NUMERO = 'Qual número devo usar para falar com você sobre a reserva? Mande com DDD, por exemplo: (61) 99999-8888.'
const confirmada = (resumo: string) => `Reserva feita: unidade ${resumo}.\n\n${REGRAS_RESERVA_PADRAO}`

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
    { restaurantId, escopo: 'simulacao', periodo: 'dia', limiteUsd: '1' },
    { restaurantId, escopo: 'simulacao', periodo: 'mes', limiteUsd: '10' },
  ])
  return { restaurantId, ids }
}

const capacidade = (unitId: string, n: number) => db.update(schema.units).set({ capacidadePessoas: n }).where(eq(schema.units.id, unitId))
/** Reserva de outra pessoa (pelo painel), ocupando vagas do dia. */
const ocupar = (restaurantId: string, unitId: string, pessoas: number, simulado = false) =>
  db.insert(schema.attendanceNotices).values({
    restaurantId, unitId, data: HOJE, pessoas, horario: '19:00', nome: 'Outra pessoa', origem: 'painel', simulado,
  })

async function receive(restaurantId: string, texto: string) {
  const r = await ingestInbound(db, {
    restaurantId, waIdHash: 'hash-maria', telefoneCifrado: encryptPhone('5561999998888', phoneKey), profileName: 'Maria',
    timestamp: new Date(), wamid: `wamid.${randomUUID()}`, tipo: 'texto', texto, mediaId: null, interativoId: null,
  }, noopEnqueue)
  return r.conversationId
}

function fakeLlm(script: TriageV7[]) {
  const calls: string[] = []
  const llm: LlmClient = {
    async completeJson(p) {
      calls.push(p.user)
      return {
        ok: true as const, data: p.parse(script[Math.min(calls.length - 1, script.length - 1)]), model: 'fake/m',
        usage: { tokensIn: 100, tokensOut: 20, tokensCache: 0, costUsd: '0.000200' }, latencyMs: 10,
      }
    },
  }
  return { llm, calls }
}

function fakeWa() {
  const enviados: { tipo: string; corpo: unknown }[] = []
  const ok = (): SendResult => ({ ok: true, wamid: `wamid.out.${randomUUID()}` })
  return {
    enviados,
    async sendText(_to: string, texto: string) { enviados.push({ tipo: 'texto', corpo: texto }); return ok() },
    async sendLocation(_to: string, loc: unknown) { enviados.push({ tipo: 'localizacao', corpo: loc }); return ok() },
    async sendList(_to: string, l: unknown) { enviados.push({ tipo: 'lista', corpo: l }); return ok() },
  }
}

function logCapturado() {
  const linhas: string[] = []
  const destino = new Writable({ write(chunk, _enc, cb) { linhas.push(String(chunk)); cb() } })
  return { linhas, log: createLogger('debug', destino) }
}

const deps = (llm: LlmClient, wa: Parameters<typeof comMidiaProibida>[0], log = createLogger('silent')): ProcessDeps =>
  ({ db, llm, wa: comMidiaProibida(wa), storage: storageProibido, phoneKey, triageModels: ['fake/m'], log, requeue: async () => undefined, now: () => SEG_14H })
const conversa = async (id: string) => (await db.select().from(schema.conversations).where(eq(schema.conversations.id, id)))[0]!
const reservas = () => db.select().from(schema.attendanceNotices).orderBy(asc(schema.attendanceNotices.createdAt))
const minhas = async () => (await reservas()).filter((r) => r.origem === 'ia')
const ultimoTexto = (wa: ReturnType<typeof fakeWa>) => wa.enviados.at(-1)!.corpo as string
const auditReserva = async () =>
  (await db.select().from(schema.auditLog).orderBy(asc(schema.auditLog.id))).filter((a) => a.acao.startsWith('reserva.'))

/** Leva a conversa até a pergunta de contato: unidade e dia pela triagem; pessoas, horário e nome em respostas curtas. */
async function ateOContato(restaurantId: string, wa: ReturnType<typeof fakeWa>, llm: LlmClient) {
  const conv = await receive(restaurantId, 'quero reservar para hoje')
  await processConversation(deps(llm, wa), conv)
  for (const resposta of ['4', '20h', 'Carlos Souza']) {
    await receive(restaurantId, resposta)
    await processConversation(deps(llm, wa), conv)
  }
  expect(ultimoTexto(wa)).toBe(PERGUNTA_CONTATO)
  return conv
}

describe('reserva no worker (triage-v7)', () => {
  it('conversa completa: um dado por vez, sem LLM nas respostas curtas, confirma com as regras e audita sem PII', async () => {
    const { restaurantId, ids } = await setup()
    const { llm, calls } = fakeLlm([triagem(res({ data: 'hoje' }))])
    const wa = fakeWa()
    const conv = await receive(restaurantId, 'quero reservar para hoje')
    expect(await processConversation(deps(llm, wa), conv)).toBe('replied')
    expect(ultimoTexto(wa)).toBe('Para quantas pessoas?')
    expect((await conversa(conv)).pendente).toMatchObject({
      tipo: 'reserva', campo: 'pessoas', unitId: ids['Asa Sul'], item: { unidade: 'Asa Sul', data: HOJE, pessoas: null },
    })

    const passos: [string, string, string][] = [
      ['4', 'Para que horas é a reserva?', 'horario'],
      ['às 20h', 'Em nome de quem fica a reserva?', 'nome'],
      ['Carlos Souza', PERGUNTA_CONTATO, 'contato'],
    ]
    for (const [resposta, pergunta, campo] of passos) {
      await receive(restaurantId, resposta)
      await processConversation(deps(llm, wa), conv)
      expect(ultimoTexto(wa)).toBe(pergunta)
      expect((await conversa(conv)).pendente).toMatchObject({ tipo: 'reserva', campo })
    }
    await receive(restaurantId, 'pode sim')
    await processConversation(deps(llm, wa), conv)

    expect(calls).toHaveLength(1)
    expect(ultimoTexto(wa)).toBe(confirmada('Asa Sul, hoje, às 20h, 4 pessoas, em nome de Carlos Souza'))
    const [r] = await minhas()
    expect(r).toMatchObject({
      unitId: ids['Asa Sul'], data: HOJE, pessoas: 4, horario: '20:00:00', nome: 'Carlos Souza', contatoCifrado: null,
      status: 'confirmada', simulado: false, origem: 'ia',
    })
    expect((await conversa(conv)).pendente).toBeNull()
    const audit = await auditReserva()
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ acao: 'reserva.registrada', atorTipo: 'ia', entidade: 'attendance_notice', entidadeId: r!.id, diff: null })
    const runs = await db.select().from(schema.aiRuns).orderBy(asc(schema.aiRuns.id))
    expect(runs[0]).toMatchObject({ promptVersion: 'triage-v7', intent: 'aviso_presenca:registrar' })
    expect(runs.slice(1).map((x) => [x.promptVersion, x.intent])).toEqual([
      ['s2-reserva', 'resposta_pessoas'], ['s2-reserva', 'resposta_horario'], ['s2-reserva', 'resposta_nome'], ['s2-reserva', 'resposta_contato'],
    ])
    expect(runs.at(-1)).toMatchObject({ itensValidos: 1, itensRespondidos: 1, modelo: 'deterministico', costUsd: '0.000000' })
  })

  it('a resposta que não é curta vai à triagem com a pergunta e o que já sabemos (sem o nome)', async () => {
    const { restaurantId } = await setup()
    const { llm, calls } = fakeLlm([triagem(res({ data: 'hoje' })), triagem(res({ horario: '20h' }))])
    const wa = fakeWa()
    const conv = await receive(restaurantId, 'quero reservar para hoje')
    await processConversation(deps(llm, wa), conv)
    for (const resposta of ['4']) {
      await receive(restaurantId, resposta)
      await processConversation(deps(llm, wa), conv)
    }
    await receive(restaurantId, 'acho que lá pelas oito da noite fica bom pra gente')
    await processConversation(deps(llm, wa), conv)
    expect(calls).toHaveLength(2)
    expect(calls[1]).toContain('<pergunta_pendente>\nPara que horas é a reserva?')
    expect(calls[1]).toContain('"pessoas":4')
    // o item da triagem só trouxe o horário: o resto veio da reserva guardada
    expect(ultimoTexto(wa)).toBe('Em nome de quem fica a reserva?')
    expect((await conversa(conv)).pendente).toMatchObject({ campo: 'nome', item: { pessoas: 4, horario: '20:00', data: HOJE } })
  })

  it('"contato_ok" da triagem sem a pergunta de contato pendente não vale: pergunta o contato', async () => {
    const { restaurantId } = await setup()
    const { llm } = fakeLlm([triagem(res({ data: 'hoje', pessoas: 2, horario: '20h', nome: 'Ana', contato_ok: true }))])
    const wa = fakeWa()
    const conv = await receive(restaurantId, 'reserva hoje 20h para 2 em nome de Ana, pode usar esse número')
    await processConversation(deps(llm, wa), conv)
    expect(ultimoTexto(wa)).toBe(PERGUNTA_CONTATO)
    expect(await minhas()).toHaveLength(0)
  })

  it('lotado: oferece outras unidades, outro dia e grupo menor; "e na Asa Norte?" continua com o que já foi dito', async () => {
    const { restaurantId, ids } = await setup(4)
    await capacidade(ids['Asa Sul']!, 10)
    await ocupar(restaurantId, ids['Asa Sul']!, 8)
    await capacidade(ids['Lago Sul']!, 3) // sem vaga para 4: fica de fora da oferta
    const { llm, calls } = fakeLlm([
      triagem(res({ unidade: 'asa sul', data: 'hoje', pessoas: 4, horario: '20h', nome: 'Ana' })),
      triagem(res({ unidade: 'asa norte' })),
    ])
    const wa = fakeWa()
    const conv = await receive(restaurantId, 'reserva hoje na asa sul, 4 pessoas às 20h, em nome de Ana')
    await processConversation(deps(llm, wa), conv)
    expect(ultimoTexto(wa)).toBe(
      'A unidade Asa Sul está lotada hoje para 4 pessoas. Nesse dia, temos vaga para 4 pessoas em: Asa Norte e Águas Claras. '
      + 'Se preferir, me diga outro dia. Na unidade Asa Sul, ainda temos vaga para até 2 pessoas.',
    )
    expect(await minhas()).toHaveLength(0)
    expect((await conversa(conv)).pendente).toMatchObject({
      tipo: 'reserva', campo: 'lotado', unitId: null, item: { unidade: 'Asa Sul', data: HOJE, pessoas: 4, horario: '20:00', nome: 'Ana' },
    })

    await receive(restaurantId, 'e na Asa Norte?')
    await processConversation(deps(llm, wa), conv)
    expect(calls).toHaveLength(2)
    expect(calls[1]).toContain('<pergunta_pendente>')
    expect(calls[1]).not.toContain('Ana')
    expect(ultimoTexto(wa)).toBe(PERGUNTA_CONTATO)
    expect((await conversa(conv)).pendente).toMatchObject({ campo: 'contato', unitId: ids['Asa Norte'], item: { nome: 'Ana', pessoas: 4 } })
    await receive(restaurantId, 'sim')
    await processConversation(deps(llm, wa), conv)
    expect(ultimoTexto(wa)).toBe(confirmada('Asa Norte, hoje, às 20h, 4 pessoas, em nome de Ana'))
    expect(await minhas()).toMatchObject([{ unitId: ids['Asa Norte'], pessoas: 4 }])
  })

  it.each(['Beleza', 'ok', 'Esquece', 'sim', 'não', 'Tudo bem', 'Desisto', 'Asa Sul', 'asa  sul', '204 sul', 'Casa Teste', 'Quanto custa', 'Combinado', '20h', '4'])(
    '"%s" ao "Em nome de quem?" não vira nome sem o modelo',
    async (resposta) => {
      const { restaurantId, ids } = await setup()
      await db.update(schema.units).set({ apelidos: ['204 sul'] }).where(eq(schema.units.id, ids['Asa Sul']!))
      const { llm } = fakeLlm([triagem(res({ data: 'hoje', pessoas: 4, horario: '20h' })), triagem()])
      const wa = fakeWa()
      const conv = await receive(restaurantId, 'reserva hoje 4 pessoas 20h')
      await processConversation(deps(llm, wa), conv)
      expect(ultimoTexto(wa)).toBe('Em nome de quem fica a reserva?')
      await receive(restaurantId, resposta)
      await processConversation(deps(llm, wa), conv)
      // vai à triagem (ou ao pré-filtro: "ok", "beleza"), nunca vira o nome da reserva
      expect(ultimoTexto(wa)).not.toBe(PERGUNTA_CONTATO)
      expect(JSON.stringify((await conversa(conv)).pendente ?? {})).not.toContain(`"nome":"${resposta}"`)
    },
  )

  it.each(['Maria', 'carlos souza', 'Maria da Silva', "Joana D'Arc"])('"%s" ao "Em nome de quem?" é nome, sem o modelo', async (resposta) => {
    const { restaurantId } = await setup()
    const { llm, calls } = fakeLlm([triagem(res({ data: 'hoje', pessoas: 4, horario: '20h' }))])
    const wa = fakeWa()
    const conv = await receive(restaurantId, 'reserva hoje 4 pessoas 20h')
    await processConversation(deps(llm, wa), conv)
    await receive(restaurantId, resposta)
    await processConversation(deps(llm, wa), conv)
    expect(calls).toHaveLength(1)
    expect(ultimoTexto(wa)).toBe(PERGUNTA_CONTATO)
  })

  it('nome vindo da triagem igual a uma unidade ou ao restaurante não vale: pergunta o nome', async () => {
    const { restaurantId } = await setup(4)
    const { llm } = fakeLlm([triagem(res({ unidade: 'asa sul', data: 'hoje', pessoas: 4, horario: '20h', nome: 'Asa Norte' }))])
    const wa = fakeWa()
    const conv = await receive(restaurantId, 'reserva na asa sul hoje 4 pessoas 20h, asa norte')
    await processConversation(deps(llm, wa), conv)
    expect(ultimoTexto(wa)).toBe('Em nome de quem fica a reserva?')
    const { llm: llm2 } = fakeLlm([triagem(res({ unidade: 'asa sul', data: 'hoje', pessoas: 4, horario: '20h', nome: 'Casa Teste' }))])
    const conv2 = await receive(restaurantId, 'reserva na asa sul hoje 4 pessoas 20h em nome da casa teste')
    await processConversation(deps(llm2, wa), conv2)
    expect(ultimoTexto(wa)).toBe('Em nome de quem fica a reserva?')
  })

  it.each(['e 15 de outubro?', 'e no 12?', 'pode ser 3 de novembro', 'dia 20', 'e sábado?', 'e na unidade 2?', 'e dia 15/10?'])(
    '"%s" depois do lotado não vira pessoas sem o modelo',
    async (resposta) => {
      const { restaurantId, ids } = await setup()
      await capacidade(ids['Asa Sul']!, 10)
      await ocupar(restaurantId, ids['Asa Sul']!, 8)
      const { llm, calls } = fakeLlm([triagem(res({ data: 'hoje', pessoas: 4, horario: '20h', nome: 'Ana' })), triagem()])
      const wa = fakeWa()
      const conv = await receive(restaurantId, 'reserva hoje, 4 pessoas às 20h, em nome de Ana')
      await processConversation(deps(llm, wa), conv)
      expect(ultimoTexto(wa)).toContain('está lotada hoje')
      await receive(restaurantId, resposta)
      await processConversation(deps(llm, wa), conv)
      expect(calls).toHaveLength(2)
    },
  )

  it.each(['e 15 de outubro?', 'no 12', 'dia 20'])('"%s" ao "Para quantas pessoas?" vai à triagem', async (resposta) => {
    const { restaurantId } = await setup()
    const { llm, calls } = fakeLlm([triagem(res({ data: 'hoje' })), triagem()])
    const wa = fakeWa()
    const conv = await receive(restaurantId, 'quero reservar para hoje')
    await processConversation(deps(llm, wa), conv)
    await receive(restaurantId, resposta)
    await processConversation(deps(llm, wa), conv)
    expect(calls).toHaveLength(2)
  })

  it.each([['15', 15], ['somos 15', 15], ['para 3', 3], ['e para 2?', 2]])('"%s" depois do lotado continua sendo pessoas (%i)', async (resposta, n) => {
    const { restaurantId, ids } = await setup()
    await capacidade(ids['Asa Sul']!, 30)
    await ocupar(restaurantId, ids['Asa Sul']!, 28)
    const { llm, calls } = fakeLlm([triagem(res({ data: 'hoje', pessoas: 4, horario: '20h', nome: 'Ana' }))])
    const wa = fakeWa()
    const conv = await receive(restaurantId, 'reserva hoje, 4 pessoas às 20h, em nome de Ana')
    await processConversation(deps(llm, wa), conv)
    await receive(restaurantId, resposta)
    await processConversation(deps(llm, wa), conv)
    expect(calls).toHaveLength(1)
    expect((await conversa(conv)).pendente).toMatchObject({ item: { pessoas: n } })
  })

  it.each([['20 30', '20:30'], ['20:30', '20:30'], ['às 20h30', '20:30'], ['20h', '20:00']])('"%s" ao "Para que horas?" grava %s', async (resposta, hhmm) => {
    const { restaurantId } = await setup()
    const { llm } = fakeLlm([triagem(res({ data: 'hoje', pessoas: 4 })), triagem()])
    const wa = fakeWa()
    const conv = await receive(restaurantId, 'reserva hoje 4 pessoas')
    await processConversation(deps(llm, wa), conv)
    await receive(restaurantId, resposta)
    await processConversation(deps(llm, wa), conv)
    expect((await conversa(conv)).pendente).toMatchObject({ campo: 'nome', item: { horario: hhmm } })
  })

  it('humano assume com a pergunta de contato pendente: a mensagem com o número fica mascarada mesmo assim', async () => {
    const { restaurantId } = await setup()
    const { llm } = fakeLlm([triagem(res({ data: 'hoje' }))])
    const wa = fakeWa()
    const conv = await ateOContato(restaurantId, wa, llm)
    await db.update(schema.conversations).set({ estado: 'humano' }).where(eq(schema.conversations.id, conv))
    await receive(restaurantId, 'não, usa o (61) 98888-7777')
    expect(await processConversation(deps(llm, wa), conv)).toBe('human_state')
    const entradas = await db.select({ texto: schema.messages.texto }).from(schema.messages).where(eq(schema.messages.direcao, 'in'))
    expect(entradas.map((m) => m.texto).join('\n')).not.toMatch(/98888/)
  })

  it('sem orçamento com a pergunta de contato pendente: a mensagem longa com o número fica mascarada', async () => {
    const { restaurantId } = await setup()
    const { llm } = fakeLlm([triagem(res({ data: 'hoje' }))])
    const wa = fakeWa()
    const conv = await ateOContato(restaurantId, wa, llm)
    await db.update(schema.budgetLimits).set({ limiteUsd: '0.000001' })
    await receive(restaurantId, 'pode anotar o número do meu marido que é 61 98888-7777 porque esse aqui eu quase não uso')
    await processConversation(deps(llm, wa), conv)
    expect((await conversa(conv)).estado).toBe('aguardando_humano')
    const entradas = await db.select({ texto: schema.messages.texto }).from(schema.messages).where(eq(schema.messages.direcao, 'in'))
    expect(entradas.map((m) => m.texto).join('\n')).not.toMatch(/98888/)
  })

  it('erro do banco ao gravar a reserva não leva o nome ao log', async () => {
    const { restaurantId, ids } = await setup()
    const { linhas, log } = logCapturado()
    try {
      await db.insert(schema.attendanceNotices).values({
        restaurantId, unitId: ids['Asa Sul']!, data: HOJE, pessoas: 61, horario: '20:00', nome: 'Carlos Souza', origem: 'ia',
      })
      expect.unreachable()
    } catch (err) {
      log.error({ err }, 'falha ao processar conversa')
    }
    expect(linhas.join('\n')).toContain('attendance_pessoas_ck')
    expect(linhas.join('\n')).not.toMatch(/Carlos|Souza/)
  })

  it('lotado: "e para 2?" responde sem o modelo e cabe nas vagas que sobram', async () => {
    const { restaurantId, ids } = await setup()
    await capacidade(ids['Asa Sul']!, 10)
    await ocupar(restaurantId, ids['Asa Sul']!, 8)
    const { llm, calls } = fakeLlm([triagem(res({ data: 'hoje', pessoas: 4, horario: '20h', nome: 'Ana' }))])
    const wa = fakeWa()
    const conv = await receive(restaurantId, 'reserva hoje, 4 pessoas às 20h, em nome de Ana')
    await processConversation(deps(llm, wa), conv)
    expect(ultimoTexto(wa)).toContain('está lotada hoje para 4 pessoas')
    await receive(restaurantId, 'e para 2?')
    await processConversation(deps(llm, wa), conv)
    expect(calls).toHaveLength(1)
    expect(ultimoTexto(wa)).toBe(PERGUNTA_CONTATO)
    await receive(restaurantId, 'pode')
    await processConversation(deps(llm, wa), conv)
    expect(await minhas()).toMatchObject([{ pessoas: 2, nome: 'Ana', horario: '20:00:00' }])
  })

  it('corrida: a vaga é tomada entre a leitura e o commit ⇒ nada gravado, resposta de lotado e a reserva fica guardada', async () => {
    const { restaurantId, ids } = await setup(4)
    await capacidade(ids['Asa Sul']!, 10)
    await ocupar(restaurantId, ids['Asa Sul']!, 6)
    const { llm } = fakeLlm([triagem(res({ unidade: 'asa sul', data: 'hoje' }))])
    const wa = fakeWa()
    const conv = await receive(restaurantId, 'quero reservar para hoje na asa sul')
    await processConversation(deps(llm, wa), conv)
    for (const resposta of ['4', '20h', 'Carlos']) {
      await receive(restaurantId, resposta)
      await processConversation(deps(llm, wa), conv)
    }
    expect(ultimoTexto(wa)).toBe(PERGUNTA_CONTATO)

    // outra reserva confirma 2 vagas depois que o worker leu a ocupação (6/10: cabia)
    injecao.aposLerOcupacao = async () => { await ocupar(restaurantId, ids['Asa Sul']!, 2) }
    await receive(restaurantId, 'sim')
    await processConversation(deps(llm, wa), conv)
    expect(ultimoTexto(wa)).toBe(
      'A unidade Asa Sul está lotada hoje para 4 pessoas. Nesse dia, temos vaga para 4 pessoas em: Asa Norte, Lago Sul e Águas Claras. '
      + 'Se preferir, me diga outro dia.',
    )
    expect(await minhas()).toHaveLength(0)
    expect(await auditReserva()).toHaveLength(0)
    expect((await conversa(conv)).pendente).toMatchObject({ tipo: 'reserva', campo: 'lotado', item: { unidade: 'Asa Sul', pessoas: 4, nome: 'Carlos' } })
  })

  it('número novo: capturado do texto bruto, cifrado no banco e ausente do LLM, do log, do pendente e da mensagem guardada', async () => {
    const { restaurantId } = await setup()
    const { llm, calls } = fakeLlm([triagem(res({ data: 'hoje' }))])
    const wa = fakeWa()
    const { linhas, log } = logCapturado()
    const conv = await receive(restaurantId, 'quero reservar para hoje')
    await processConversation(deps(llm, wa, log), conv)
    for (const resposta of ['4', '20h', 'Carlos Souza']) {
      await receive(restaurantId, resposta)
      await processConversation(deps(llm, wa, log), conv)
    }
    // "não, usa o …": o número já vem na resposta ao "pode usar este WhatsApp?" — não pede de novo
    await receive(restaurantId, 'não, usa o (61) 98888-7777')
    await processConversation(deps(llm, wa, log), conv)

    expect(ultimoTexto(wa)).toBe(confirmada('Asa Sul, hoje, às 20h, 4 pessoas, em nome de Carlos Souza'))
    const [r] = await minhas()
    expect(r!.contatoCifrado).not.toBeNull()
    expect(r!.contatoCifrado).not.toContain('98888')
    expect(decryptPhone(r!.contatoCifrado!, phoneKey)).toBe('+5561988887777')
    expect(calls.join('\n')).not.toMatch(/98888|7777/)
    expect(linhas.join('\n')).not.toMatch(/98888|7777/)
    expect(JSON.stringify((await conversa(conv)).pendente)).not.toMatch(/98888|7777/)
    const entradas = await db.select({ texto: schema.messages.texto }).from(schema.messages).where(eq(schema.messages.direcao, 'in'))
    expect(entradas.map((m) => m.texto).join('\n')).not.toMatch(/98888|7777/)
    expect(entradas.map((m) => m.texto)).toContain('não, usa o [TELEFONE]')
  })

  it('número na pergunta do número, por uma resposta longa: a triagem só vê [TELEFONE]', async () => {
    const { restaurantId } = await setup()
    const { llm, calls } = fakeLlm([triagem(res({ data: 'hoje' })), triagem(res({ contato_ok: null }))])
    const wa = fakeWa()
    const conv = await ateOContato(restaurantId, wa, llm)
    await receive(restaurantId, 'não')
    await processConversation(deps(llm, wa), conv)
    expect(ultimoTexto(wa)).toBe(PERGUNTA_NUMERO)
    expect((await conversa(conv)).pendente).toMatchObject({ campo: 'contato_numero', item: { contato_ok: false }, tentativasNumero: 0 })

    await receive(restaurantId, 'pode anotar o número do meu marido que é +55 61 98888-7777 porque esse aqui eu quase não uso')
    await processConversation(deps(llm, wa), conv)
    expect(calls).toHaveLength(2)
    expect(calls[1]).toContain('[TELEFONE]')
    expect(calls[1]).not.toMatch(/98888|7777/)
    expect(ultimoTexto(wa)).toBe(confirmada('Asa Sul, hoje, às 20h, 4 pessoas, em nome de Carlos Souza'))
    expect(decryptPhone((await minhas())[0]!.contatoCifrado!, phoneKey)).toBe('+5561988887777')
  })

  it('número inválido: pede de novo; na segunda falha usa o WhatsApp e avisa', async () => {
    const { restaurantId } = await setup()
    const { llm, calls } = fakeLlm([triagem(res({ data: 'hoje' }))])
    const wa = fakeWa()
    const conv = await ateOContato(restaurantId, wa, llm)
    await receive(restaurantId, 'não')
    await processConversation(deps(llm, wa), conv)
    await receive(restaurantId, '61 1234')
    await processConversation(deps(llm, wa), conv)
    expect(ultimoTexto(wa)).toBe('Não consegui ler esse número. Mande com DDD, por exemplo: (61) 99999-8888.')
    expect((await conversa(conv)).pendente).toMatchObject({ campo: 'contato_numero', tentativasNumero: 1 })
    await receive(restaurantId, 'não sei')
    await processConversation(deps(llm, wa), conv)
    expect(calls).toHaveLength(1)
    expect(ultimoTexto(wa)).toBe(
      `Não consegui ler o número, então vou usar este número do WhatsApp para falar com você sobre a reserva.\n\n${
        confirmada('Asa Sul, hoje, às 20h, 4 pessoas, em nome de Carlos Souza')}`,
    )
    expect(await minhas()).toMatchObject([{ contatoCifrado: null }])
  })

  it('o próprio número do WhatsApp informado como contato vale como "sim" (não grava cópia)', async () => {
    const { restaurantId } = await setup()
    const { llm } = fakeLlm([triagem(res({ data: 'hoje' }))])
    const wa = fakeWa()
    const conv = await ateOContato(restaurantId, wa, llm)
    await receive(restaurantId, 'pode ligar no 61 99999-8888')
    await processConversation(deps(llm, wa), conv)
    expect(await minhas()).toMatchObject([{ contatoCifrado: null }])
  })

  it('"somos 80" ao "Para quantas pessoas?": segue como pedido de evento com o número real', async () => {
    const { restaurantId, ids } = await setup()
    const { llm, calls } = fakeLlm([triagem(res({ data: 'sábado' }))])
    const wa = fakeWa()
    const conv = await receive(restaurantId, 'quero reservar para sábado')
    await processConversation(deps(llm, wa), conv)
    await receive(restaurantId, 'somos 80')
    await processConversation(deps(llm, wa), conv)
    expect(calls).toHaveLength(1)
    expect(ultimoTexto(wa)).toContain('Reservas vão até 60 pessoas.')
    expect(await minhas()).toHaveLength(0)
    expect((await conversa(conv)).pendente).toMatchObject({
      tipo: 'pedido_evento', unitId: ids['Asa Sul'], item: { servico: 'evento', convidados: 80, data: '2026-10-10' },
    })
  })

  it('reserva cancelada pela equipe no meio da mudança: nada é gravado e a resposta diz isso', async () => {
    const { restaurantId } = await setup()
    const { llm } = fakeLlm([triagem(res({ data: 'hoje' })), triagem(res({ pessoas: 6 }))])
    const wa = fakeWa()
    const conv = await ateOContato(restaurantId, wa, llm)
    await receive(restaurantId, 'sim')
    await processConversation(deps(llm, wa), conv)
    const [r] = await minhas()

    injecao.aposLerOcupacao = async () => {
      await db.update(schema.attendanceNotices).set({ status: 'cancelada' }).where(eq(schema.attendanceNotices.id, r!.id))
    }
    await receive(restaurantId, 'na verdade seremos 6')
    await processConversation(deps(llm, wa), conv)
    expect(ultimoTexto(wa)).toBe('Essa reserva não está mais ativa, então não consegui mudá-la. Se quiser, posso fazer uma nova: é só me dizer.')
    expect(await minhas()).toMatchObject([{ id: r!.id, status: 'cancelada', pessoas: 4 }])
    expect((await auditReserva()).map((a) => a.acao)).toEqual(['reserva.registrada'])
  })

  it('mudar e cancelar: "reserva.atualizada" e "reserva.cancelada", sem PII na auditoria', async () => {
    const { restaurantId } = await setup()
    const { llm } = fakeLlm([triagem(res({ data: 'hoje' })), triagem(res({ pessoas: 2 })), triagem(res({ tipo: 'cancelar' }))])
    const wa = fakeWa()
    const conv = await ateOContato(restaurantId, wa, llm)
    await receive(restaurantId, 'sim')
    await processConversation(deps(llm, wa), conv)
    await receive(restaurantId, 'na verdade seremos 2')
    await processConversation(deps(llm, wa), conv)
    expect(ultimoTexto(wa)).toBe(confirmada('Asa Sul, hoje, às 20h, 2 pessoas, em nome de Carlos Souza'))
    await receive(restaurantId, 'não vou mais, pode cancelar')
    await processConversation(deps(llm, wa), conv)
    expect(ultimoTexto(wa)).toBe('Pronto, cancelei sua reserva: Asa Sul, hoje.')
    expect(await minhas()).toMatchObject([{ status: 'cancelada', pessoas: 2, nome: 'Carlos Souza' }])
    const audit = await auditReserva()
    expect(audit.map((a) => a.acao)).toEqual(['reserva.registrada', 'reserva.atualizada', 'reserva.cancelada'])
    expect(audit.every((a) => a.diff === null)).toBe(true)
  })

  it('pendente "pessoas" antigo (gravado antes da reserva) continua: "4" segue para o horário sem o modelo', async () => {
    const { restaurantId, ids } = await setup()
    const conv = await receive(restaurantId, 'vou hoje')
    await db.delete(schema.messages)
    const antigo = {
      tipo: 'pessoas', pergunta: 'vou hoje', perguntaEnviada: 'Para quantas pessoas?', unitId: ids['Asa Sul'],
      item: { servico: 'aviso_presenca', tipo: 'registrar', unidade: 'Asa Sul', data: HOJE, tema: null, pessoas: null, horario: 'à noite', convidados: null, tipoEvento: null, espaco: null, consulta: null, tag: null },
      expiraEm: '2026-10-05T17:30:00.000Z',
    }
    await db.update(schema.conversations).set({ pendente: antigo })
    const { llm, calls } = fakeLlm([])
    const wa = fakeWa()
    await receive(restaurantId, '4')
    await processConversation(deps(llm, wa), conv)
    expect(calls).toHaveLength(0)
    expect(ultimoTexto(wa)).toBe('Hoje, a unidade Asa Sul funciona das 11h às 23h. Para que horas é a reserva?')
    expect((await conversa(conv)).pendente).toMatchObject({ tipo: 'reserva', campo: 'horario', item: { pessoas: 4, data: HOJE } })
  })

  it('simulador: a lotação conta só as reservas simuladas e a reserva sai com simulado = true', async () => {
    const { restaurantId, ids } = await setup()
    await capacidade(ids['Asa Sul']!, 10)
    await ocupar(restaurantId, ids['Asa Sul']!, 9) // reais: não contam para a simulação
    const dono = await seedStaff(db, sql, { restaurantId, papel: 'dono' })
    const { conversationId } = await abrirSimulacao(db, { restaurantId, userId: dono })
    const proibido = {
      async sendText(): Promise<never> { throw new Error('Meta chamada em simulação') },
      async sendLocation(): Promise<never> { throw new Error('Meta chamada em simulação') },
      async sendList(): Promise<never> { throw new Error('Meta chamada em simulação') },
    }
    const { llm } = fakeLlm([triagem(res({ data: 'hoje', pessoas: 4, horario: '20h', nome: 'Teste' }))])
    const enviar = async (texto: string) => {
      await enviarMensagemSimulada(db, { restaurantId, userId: dono, conversationId, texto }, noopEnqueue)
      await processConversation(deps(llm, proibido), conversationId)
    }
    await enviar('reserva hoje para 4 às 20h em nome de Teste')
    await enviar('sim')
    expect(await minhas()).toMatchObject([{ pessoas: 4, simulado: true, status: 'confirmada', contatoCifrado: null }])
    // e o contrário: uma simulada não tira vaga das reais
    const real = await receive(restaurantId, 'reserva hoje para 1')
    const wa = fakeWa()
    await processConversation(deps(fakeLlm([triagem(res({ data: 'hoje', pessoas: 1, horario: '20h', nome: 'Maria' }))]).llm, wa), real)
    expect(ultimoTexto(wa)).toBe(PERGUNTA_CONTATO)
  })
})
