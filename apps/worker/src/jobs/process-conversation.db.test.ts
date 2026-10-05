import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { encryptPhone, keyFromBase64 } from '@atd/core'
import { ingestInbound, schema, type Enqueue } from '@atd/db'
import { getTestDb, resetDb, seedRestaurant } from '@atd/db/test-utils'
import type { LlmClient } from '@atd/ai'
import type { SendResult } from '@atd/whatsapp'
import { createLogger } from '../logger.ts'
import { processConversation, type ProcessDeps } from './process-conversation.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const phoneKey = keyFromBase64(Buffer.alloc(32, 5).toString('base64'))
const noopEnqueue: Enqueue = async () => undefined
const log = createLogger('silent')

async function setup(opts: { budget?: boolean } = {}) {
  const { restaurantId } = await seedRestaurant(db)
  await db.update(schema.restaurants).set({ nome: 'Casa Teste', politicaUrl: 'https://casa.test/privacidade' })
  if (opts.budget !== false) {
    await db.insert(schema.budgetLimits).values([
      { restaurantId, escopo: 'ia', periodo: 'dia', limiteUsd: '1' },
      { restaurantId, escopo: 'ia', periodo: 'mes', limiteUsd: '10' },
    ])
  }
  return restaurantId
}

type Msg = string | { tipo: 'audio' | 'imagem'; texto: null }
async function receive(restaurantId: string, msgs: Msg[]) {
  let conversationId = ''
  for (const m of msgs) {
    const r = await ingestInbound(
      db,
      {
        restaurantId, waIdHash: 'hash-maria', telefoneCifrado: encryptPhone('5561999998888', phoneKey),
        profileName: 'Maria', timestamp: new Date(), wamid: `wamid.${randomUUID()}`,
        tipo: typeof m === 'string' ? 'texto' : m.tipo, texto: typeof m === 'string' ? m : null, mediaId: null,
      },
      noopEnqueue,
    )
    conversationId = r.conversationId
  }
  return conversationId
}

type Scripted = { intent: string; confianca: number } | 'erro_temporario'
function fakeLlm(script: Scripted[]) {
  const calls: { user: string }[] = []
  const llm: LlmClient = {
    async completeJson(p) {
      calls.push({ user: p.user })
      const step = script[Math.min(calls.length - 1, script.length - 1)]!
      if (step === 'erro_temporario') {
        return { ok: false as const, error: 'upstream', retryable: true, status: 502, model: null, usage: null, latencyMs: 1 }
      }
      return {
        ok: true as const, data: p.parse(step), model: 'fake/m',
        usage: { tokensIn: 100, tokensOut: 5, tokensCache: 0, costUsd: '0.000200' }, latencyMs: 10,
      }
    },
  }
  return { llm, calls }
}

function fakeWa(behaviour?: (n: number) => SendResult | undefined) {
  const sent: { to: string; text: string }[] = []
  return {
    sent,
    async sendText(to: string, text: string): Promise<SendResult> {
      sent.push({ to, text })
      return behaviour?.(sent.length) ?? { ok: true, wamid: `wamid.out.${randomUUID()}` }
    },
  }
}

function deps(llm: LlmClient, wa: ReturnType<typeof fakeWa>): ProcessDeps {
  return { db, llm, wa, phoneKey, triageModels: ['fake/m'], log, requeue: async () => undefined }
}

const outMessages = () =>
  db.select().from(schema.messages).where(eq(schema.messages.direcao, 'out')).orderBy(schema.messages.id)

describe('processConversation', () => {
  it('primeira mensagem "oi": aviso de privacidade + saudação, sem LLM', async () => {
    const rid = await setup()
    const conv = await receive(rid, ['oi'])
    const { llm, calls } = fakeLlm([])
    const wa = fakeWa()
    expect(await processConversation(deps(llm, wa), conv)).toBe('replied')
    expect(calls).toHaveLength(0)
    expect(wa.sent.map((s) => s.to)).toEqual(['5561999998888', '5561999998888'])
    expect(wa.sent[0]!.text).toMatch(/assistente virtual[\s\S]*https:\/\/casa\.test\/privacidade/)
    expect(wa.sent[1]!.text).toMatch(/^Olá/)
    const [c] = await db.select().from(schema.customers)
    expect(c!.privacyNoticeSentAt).not.toBeNull()
    expect((await outMessages()).every((m) => m.statusEnvio === 'enviado' && m.wamid)).toBe(true)
  })

  it('aviso de privacidade não se repete na mesma conversa', async () => {
    const rid = await setup()
    const conv = await receive(rid, ['oi'])
    const wa = fakeWa()
    await processConversation(deps(fakeLlm([]).llm, wa), conv)
    await receive(rid, ['obrigado'])
    await processConversation(deps(fakeLlm([]).llm, wa), conv)
    expect(wa.sent).toHaveLength(3)
    expect(wa.sent[2]!.text).toMatch(/Por nada/)
  })

  it('rajada: uma triagem com as três mensagens e uma resposta', async () => {
    const rid = await setup()
    const conv = await receive(rid, ['oi', 'queria saber', 'abre domingo?'])
    const { llm, calls } = fakeLlm([{ intent: 'horario_unidades', confianca: 0.95 }])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.user).toContain('oi\nqueria saber\nabre domingo?')
    expect(wa.sent).toHaveLength(2) // aviso + emBreve
    expect(wa.sent[1]!.text).toMatch(/aprendendo/)
  })

  it('fora de escopo: resposta fixa, ai_run registrado e custo liquidado', async () => {
    const rid = await setup()
    const conv = await receive(rid, ['como está o tempo hoje?'])
    const wa = fakeWa()
    await processConversation(deps(fakeLlm([{ intent: 'fora_escopo', confianca: 0.97 }]).llm, wa), conv)
    expect(wa.sent.at(-1)!.text).toMatch(/só consigo ajudar com assuntos do Casa Teste/)
    const runs = await db.select().from(schema.aiRuns)
    expect(runs.map((r) => [r.etapa, r.intent, r.costUsd, r.promptVersion])).toEqual([
      ['triagem', 'fora_escopo', '0.000200', 'triage-v1'],
    ])
    const counters = await db.select().from(schema.budgetCounters).orderBy(schema.budgetCounters.periodo)
    expect(counters.map((c) => [c.reservado, c.gasto])).toEqual([
      ['0.000000', '0.000200'],
      ['0.000000', '0.000200'],
    ])
  })

  it('conversa em atendimento humano: IA não responde nem gasta (I5)', async () => {
    const rid = await setup()
    const conv = await receive(rid, ['vocês abrem hoje?'])
    await db.update(schema.conversations).set({ estado: 'humano' })
    const { llm, calls } = fakeLlm([{ intent: 'horario_unidades', confianca: 0.9 }])
    const wa = fakeWa()
    expect(await processConversation(deps(llm, wa), conv)).toBe('human_state')
    expect(calls).toHaveLength(0)
    expect(wa.sent).toHaveLength(0)
    const [c] = await db.select().from(schema.conversations)
    const [m] = await db.select().from(schema.messages)
    expect(c!.processedUpToId).toBe(m!.id)
  })

  it('sem orçamento: modo econômico, handoff e nenhuma chamada ao LLM (I6)', async () => {
    const rid = await setup({ budget: false })
    const conv = await receive(rid, ['tem carne de sol?'])
    const { llm, calls } = fakeLlm([{ intent: 'cardapio', confianca: 0.9 }])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    expect(calls).toHaveLength(0)
    expect(wa.sent.at(-1)!.text).toMatch(/não consigo responder automaticamente/)
    const [c] = await db.select().from(schema.conversations)
    expect(c!.estado).toBe('aguardando_humano')
    const audit = await db.select().from(schema.auditLog)
    expect(audit.map((a) => a.acao)).toEqual(['orcamento.sem_saldo'])
  })

  it('pedido de atendente: handoff sem LLM e auditado', async () => {
    const rid = await setup()
    const conv = await receive(rid, ['quero falar com atendente'])
    const { llm, calls } = fakeLlm([])
    await processConversation(deps(llm, fakeWa()), conv)
    expect(calls).toHaveLength(0)
    const [c] = await db.select().from(schema.conversations)
    expect(c!.estado).toBe('aguardando_humano')
    expect((await db.select().from(schema.auditLog)).map((a) => a.acao)).toEqual(['conversa.handoff_pedido'])
  })

  it('pedido LGPD de exclusão vira data_subject_request', async () => {
    const rid = await setup()
    const conv = await receive(rid, ['quero apagar meus dados'])
    const wa = fakeWa()
    await processConversation(deps(fakeLlm([]).llm, wa), conv)
    const [dsr] = await db.select().from(schema.dataSubjectRequests)
    expect([dsr!.tipo, dsr!.status]).toEqual(['exclusao', 'aberto'])
    expect(wa.sent.at(-1)!.text).toMatch(/15 dias/)
  })

  it('LLM falha duas vezes: resposta de erro, handoff e falhas contadas', async () => {
    const rid = await setup()
    const conv = await receive(rid, ['qual o endereço?'])
    const { llm, calls } = fakeLlm(['erro_temporario', 'erro_temporario'])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    expect(calls).toHaveLength(2)
    expect(wa.sent.at(-1)!.text).toMatch(/Tive um problema/)
    const [c] = await db.select().from(schema.conversations)
    expect([c!.estado, c!.falhasConsecutivas]).toEqual(['aguardando_humano', 1])
    expect((await db.select().from(schema.aiRuns)).map((r) => r.resultado)).toEqual(['erro', 'erro'])
    const [dia] = await db.select().from(schema.budgetCounters).orderBy(schema.budgetCounters.periodo)
    expect(dia!.reservado).toBe('0.000000') // reserva devolvida
    expect(dia!.gasto).toBe('0.000000')
    expect((await db.select().from(schema.aiRuns)).map((r) => r.costUsd)).toEqual(['0.000000', '0.000000'])
  })

  it('envio com falha temporária: lança; retentativa entrega sem nova chamada ao LLM', async () => {
    const rid = await setup()
    const conv = await receive(rid, ['como está o tempo?'])
    const { llm, calls } = fakeLlm([{ intent: 'fora_escopo', confianca: 0.95 }])
    const flaky = fakeWa((n) => (n === 1 ? { ok: false, retryable: true, code: 130429, message: 'rate' } : undefined))
    await expect(processConversation(deps(llm, flaky), conv)).rejects.toThrow(/temporária/)
    expect((await outMessages()).map((m) => m.statusEnvio)).toEqual(['pendente', 'pendente'])
    const ok = fakeWa()
    await processConversation(deps(llm, ok), conv)
    expect(calls).toHaveLength(1)
    expect(ok.sent).toHaveLength(2)
    expect((await outMessages()).map((m) => m.statusEnvio)).toEqual(['enviado', 'enviado'])
  })

  it('envio com falha permanente: registra e não lança', async () => {
    const rid = await setup()
    const conv = await receive(rid, ['oi'])
    const wa = fakeWa(() => ({ ok: false, retryable: false, code: 131047, message: 'janela' }))
    await expect(processConversation(deps(fakeLlm([]).llm, wa), conv)).resolves.toBe('replied')
    expect((await outMessages()).map((m) => m.statusEnvio)).toEqual(['falhou:131047', 'falhou:131047'])
  })

  it('áudio na Etapa 01: resposta educada, sem LLM', async () => {
    const rid = await setup()
    const conv = await receive(rid, [{ tipo: 'audio', texto: null }])
    const { llm, calls } = fakeLlm([])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    expect(calls).toHaveLength(0)
    expect(wa.sent.at(-1)!.text).toMatch(/só consigo ler mensagens de texto/)
  })

  it('flood: mais de 10 mensagens em 1 minuto bloqueia temporariamente sem responder', async () => {
    const rid = await setup()
    const conv = await receive(rid, Array.from({ length: 11 }, (_, i) => `msg ${i}`))
    const { llm, calls } = fakeLlm([])
    const wa = fakeWa()
    expect(await processConversation(deps(llm, wa), conv)).toBe('flood')
    expect(calls).toHaveLength(0)
    expect(wa.sent).toHaveLength(0)
    const [c] = await db.select().from(schema.customers)
    expect(c!.bloqueadoAte!.getTime()).toBeGreaterThan(Date.now())
  })

  it('idempotente: segunda execução sem mensagens novas não faz nada', async () => {
    const rid = await setup()
    const conv = await receive(rid, ['oi'])
    const wa = fakeWa()
    await processConversation(deps(fakeLlm([]).llm, wa), conv)
    expect(await processConversation(deps(fakeLlm([]).llm, wa), conv)).toBe('nothing')
    expect(wa.sent).toHaveLength(2)
  })

  it('mensagem chegada após o snapshot da decisão: reenfileira a conversa uma vez', async () => {
    const rid = await setup()
    const conv = await receive(rid, ['oi'])
    const requeued: string[] = []
    const wa = fakeWa()
    const racing = {
      async sendText(to: string, text: string): Promise<SendResult> {
        const r = await wa.sendText(to, text)
        if (wa.sent.length === 1) await receive(rid, ['mais uma coisa'])
        return r
      },
    }
    const d: ProcessDeps = { ...deps(fakeLlm([]).llm, wa), wa: racing, requeue: async (id) => void requeued.push(id) }
    await processConversation(d, conv)
    expect(requeued).toEqual([conv])
  })

  it('sem mensagens novas: não reenfileira', async () => {
    const rid = await setup()
    const conv = await receive(rid, ['oi'])
    const requeued: string[] = []
    await processConversation({ ...deps(fakeLlm([]).llm, fakeWa()), requeue: async (id) => void requeued.push(id) }, conv)
    expect(requeued).toEqual([])
  })

  it('custo desconhecido: contabiliza a estimativa e avisa quando excede', async () => {
    const rid = await setup()
    const conv = await receive(rid, ['como está o tempo?'])
    const llm: LlmClient = {
      async completeJson(p) {
        return {
          ok: true as const, data: p.parse({ intent: 'fora_escopo', confianca: 0.95 }), model: 'fake/m',
          usage: { tokensIn: 1, tokensOut: 1, tokensCache: 0, costUsd: null }, latencyMs: 1,
        }
      },
    }
    await processConversation(deps(llm, fakeWa()), conv)
    const [run] = await db.select().from(schema.aiRuns)
    expect(run!.costUsd).toBe('0.005000')
    const [dia] = await db.select().from(schema.budgetCounters).orderBy(schema.budgetCounters.periodo)
    expect(dia!.gasto).toBe('0.005000')
  })

  it('humano assume durante a triagem: IA não responde, estado preservado, ai_run registrado (I5)', async () => {
    const rid = await setup()
    const conv = await receive(rid, ['como está o tempo?'])
    const inner = fakeLlm([{ intent: 'fora_escopo', confianca: 0.95 }]).llm
    const llm: LlmClient = {
      async completeJson(p) {
        await db.update(schema.conversations).set({ estado: 'humano' })
        return inner.completeJson(p)
      },
    }
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    expect(wa.sent).toHaveLength(0)
    const [c] = await db.select().from(schema.conversations)
    const [m] = await db.select().from(schema.messages)
    expect(c!.estado).toBe('humano')
    expect(c!.processedUpToId).toBe(m!.id)
    expect(await db.select().from(schema.aiRuns)).toHaveLength(1)
    expect(await outMessages()).toHaveLength(0)
  })

  it('exceção após a reserva: reserva devolvida e job lança', async () => {
    const rid = await setup()
    const conv = await receive(rid, ['como está o tempo?'])
    const llm: LlmClient = {
      async completeJson() {
        throw new Error('boom')
      },
    }
    await expect(processConversation(deps(llm, fakeWa()), conv)).rejects.toThrow(/boom/)
    const counters = await db.select().from(schema.budgetCounters)
    expect(counters.map((c) => [c.reservado, c.gasto])).toEqual([
      ['0.000000', '0.000000'],
      ['0.000000', '0.000000'],
    ])
  })

  it('humano assume entre decidir e entregar: resposta da IA cancelada, não enviada (I5)', async () => {
    const rid = await setup()
    const conv = await receive(rid, ['como está o tempo?'])
    const { llm } = fakeLlm([{ intent: 'fora_escopo', confianca: 0.95 }])
    const flaky = fakeWa((n) => (n === 1 ? { ok: false, retryable: true, code: 130429, message: 'rate' } : undefined))
    await expect(processConversation(deps(llm, flaky), conv)).rejects.toThrow(/temporária/)
    await db.update(schema.conversations).set({ estado: 'humano' })
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    const out = await outMessages()
    expect(out.map((m) => [m.autor, m.statusEnvio])).toEqual([
      ['sistema', 'enviado'],
      ['ia', 'cancelado'],
    ])
    expect(wa.sent).toHaveLength(1)
  })

  it('aviso de privacidade recusado em definitivo: privacy_notice_sent_at permanece nulo', async () => {
    const rid = await setup()
    const conv = await receive(rid, ['oi'])
    const wa = fakeWa(() => ({ ok: false, retryable: false, code: 131047, message: 'janela' }))
    await processConversation(deps(fakeLlm([]).llm, wa), conv)
    const [c] = await db.select().from(schema.customers)
    expect(c!.privacyNoticeSentAt).toBeNull()
  })

  it('aviso falha temporariamente e chega nova mensagem: um único aviso no total', async () => {
    const rid = await setup()
    const conv = await receive(rid, ['oi'])
    const flaky = fakeWa((n) => (n === 1 ? { ok: false, retryable: true, code: 130429, message: 'rate' } : undefined))
    await expect(processConversation(deps(fakeLlm([]).llm, flaky), conv)).rejects.toThrow(/temporária/)
    await receive(rid, ['obrigado'])
    const wa = fakeWa()
    await processConversation(deps(fakeLlm([]).llm, wa), conv)
    const out = await outMessages()
    expect(out.filter((m) => m.replyKey === 'avisoPrivacidade')).toHaveLength(1)
    expect(wa.sent.filter((s) => /política de privacidade/.test(s.text))).toHaveLength(1)
    const [c] = await db.select().from(schema.customers)
    expect(c!.privacyNoticeSentAt).not.toBeNull()
  })

  it('falha no commit após triagem paga: contabiliza o gasto e propaga o erro original', async () => {
    const rid = await setup()
    const conv = await receive(rid, ['como está o tempo?'])
    const inner = fakeLlm([{ intent: 'fora_escopo', confianca: 0.95 }]).llm
    const llm: LlmClient = {
      async completeJson(p) {
        const r = await inner.completeJson(p)
        return r.ok ? { ...r, model: 'fake/\u0000m' } : r // NUL em text: o INSERT de ai_runs falha
      },
    }
    await expect(processConversation(deps(llm, fakeWa()), conv)).rejects.toThrow()
    const counters = await db.select().from(schema.budgetCounters).orderBy(schema.budgetCounters.periodo)
    expect(counters.map((c) => [c.reservado, c.gasto])).toEqual([
      ['0.000000', '0.000200'],
      ['0.000000', '0.000200'],
    ])
    expect(await db.select().from(schema.aiRuns)).toHaveLength(0)
  })

  it('falha retentável paga seguida de exceção: gasto da primeira chamada contabilizado e erro original propagado', async () => {
    const rid = await setup()
    const conv = await receive(rid, ['como está o tempo?'])
    let n = 0
    const llm: LlmClient = {
      async completeJson() {
        n += 1
        if (n === 1) {
          return {
            ok: false as const, error: 'upstream', retryable: true, status: 502, model: 'fake/m',
            usage: { tokensIn: 100, tokensOut: 0, tokensCache: 0, costUsd: '0.000200' }, latencyMs: 1,
          }
        }
        throw new Error('falha de rede')
      },
    }
    await expect(processConversation(deps(llm, fakeWa()), conv)).rejects.toThrow('falha de rede')
    expect(n).toBe(2)
    const counters = await db.select().from(schema.budgetCounters).orderBy(schema.budgetCounters.periodo)
    expect(counters.map((c) => [c.reservado, c.gasto])).toEqual([
      ['0.000000', '0.000200'],
      ['0.000000', '0.000200'],
    ])
  })
})
