import type * as Db from '@atd/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireStaff = vi.fn()
const db = {
  select: () => ({ from: () => ({ where: async () => [{ tz: 'America/Sao_Paulo' }] }) }),
}
const enqueue = vi.fn()
const m = {
  abrirSimulacao: vi.fn(), novoClienteSimulado: vi.fn(), enviarMensagemSimulada: vi.fn(),
  definirRelogioSimulado: vi.fn(), mensagensSimuladas: vi.fn(), detalhesSimulacao: vi.fn(),
  registrarAuditoria: vi.fn(),
}
vi.mock('@/lib/dal', () => ({ requireStaff }))
vi.mock('@/lib/server/db', () => ({ getDb: () => db }))
vi.mock('@/lib/server/boss', () => ({ getBoss: async () => 'boss' }))
vi.mock('@atd/db', async (orig) => ({
  ...m,
  withUserContext: async (_db: unknown, _c: unknown, fn: (tx: string) => unknown) => fn('tx'),
  enqueueProcess: () => enqueue,
  schema: (await orig<typeof Db>()).schema,
}))

const a = await import('./simulador-actions')
const CONV = '00000000-0000-4000-8000-000000000001'
const sessao = { userId: 'u1', role: 'dono', restaurantId: 'r1', claims: { sub: 'u1' } }
const vazio = { mensagens: [], cursor: 0, digitando: false, estado: 'ia', relogioOffsetSegundos: null }

describe('Server Actions do simulador', () => {
  it('audita abrir, novo cliente e relógio (sem texto de cliente no diff)', async () => {
    m.abrirSimulacao.mockResolvedValue({ conversationId: CONV })
    m.novoClienteSimulado.mockResolvedValue({ conversationId: CONV })
    m.definirRelogioSimulado.mockResolvedValue('ok')
    await a.abrirSimuladorAction()
    await a.novoClienteSimuladorAction()
    await a.relogioSimuladorAction(CONV, null)
    expect(m.registrarAuditoria.mock.calls.map((c) => [c[0], c[1], c[2].restaurantId, c[2].acao, c[2].entidade, c[2].entidadeId])).toEqual([
      ['tx', sessao.claims, 'r1', 'simulador.aberto', 'conversation', CONV],
      ['tx', sessao.claims, 'r1', 'simulador.novo_cliente', 'conversation', CONV],
      ['tx', sessao.claims, 'r1', 'simulador.relogio', 'conversation', CONV],
    ])
  })

  it('relógio recusado não audita', async () => {
    m.definirRelogioSimulado.mockResolvedValue('nao_encontrada')
    await a.relogioSimuladorAction(CONV, null)
    expect(m.registrarAuditoria).not.toHaveBeenCalled()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    requireStaff.mockResolvedValue(sessao)
    m.mensagensSimuladas.mockResolvedValue(vazio)
  })

  it('toda action exige dono ou gerente', async () => {
    m.abrirSimulacao.mockResolvedValue({ conversationId: CONV })
    m.novoClienteSimulado.mockResolvedValue({ conversationId: CONV })
    m.enviarMensagemSimulada.mockResolvedValue('ok')
    m.definirRelogioSimulado.mockResolvedValue('ok')
    m.detalhesSimulacao.mockResolvedValue([])
    await a.abrirSimuladorAction()
    await a.buscarSimuladorAction(CONV, 0)
    await a.enviarSimuladorAction(CONV, 'oi', null)
    await a.novoClienteSimuladorAction()
    await a.relogioSimuladorAction(CONV, null)
    await a.detalhesSimuladorAction(CONV)
    expect(requireStaff).toHaveBeenCalledTimes(6)
    for (const c of requireStaff.mock.calls) expect(c).toEqual([['dono', 'gerente']])
  })

  it('abrir devolve a conversa com as datas em texto', async () => {
    m.abrirSimulacao.mockResolvedValue({ conversationId: CONV })
    m.mensagensSimuladas.mockResolvedValue({
      ...vazio, cursor: 7,
      mensagens: [{ id: 7, direcao: 'in', tipo: 'texto', texto: 'oi', payload: null, createdAt: new Date('2026-10-05T17:00:00Z') }],
    })
    expect(await a.abrirSimuladorAction()).toEqual({
      ok: true,
      data: {
        conversationId: CONV, cursor: 7, digitando: false, estado: 'ia', relogioOffsetSegundos: null,
        mensagens: [{ id: 7, direcao: 'in', tipo: 'texto', texto: 'oi', payload: null, criadaEm: '2026-10-05T17:00:00.000Z' }],
      },
    })
    expect(m.abrirSimulacao).toHaveBeenCalledWith(db, { restaurantId: 'r1', userId: 'u1' })
  })

  it('enviar: valida, usa a fila do webhook e traduz conversa encerrada', async () => {
    expect(await a.enviarSimuladorAction(CONV, '   ', null)).toEqual({ ok: false, fieldErrors: { texto: 'Escreva uma mensagem.' } })
    expect(await a.enviarSimuladorAction('x', 'oi', null)).toMatchObject({ ok: false })
    expect(m.enviarMensagemSimulada).not.toHaveBeenCalled()
    m.enviarMensagemSimulada.mockResolvedValue('encerrada')
    expect(await a.enviarSimuladorAction(CONV, ' oi ', 'u1')).toEqual({
      ok: false, formError: 'Esta conversa foi encerrada. Toque em "Novo cliente" para recomeçar.',
    })
    expect(m.enviarMensagemSimulada).toHaveBeenCalledWith(db, { restaurantId: 'r1', userId: 'u1', conversationId: CONV, texto: 'oi', interativoId: 'u1' }, enqueue)
  })

  it('simulação de outra pessoa (ou apagada) não vaza: erro genérico', async () => {
    m.mensagensSimuladas.mockResolvedValue(null)
    expect(await a.buscarSimuladorAction(CONV, 0)).toEqual({
      ok: false, formError: 'Esta simulação não está mais disponível. Toque em "Novo cliente".',
    })
  })

  it('relógio: converte no fuso do restaurante, recusa data inválida e mais de um ano de distância', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-05T17:00:00Z'), toFake: ['Date'] })
    try {
      m.definirRelogioSimulado.mockResolvedValue('ok')
      expect(await a.relogioSimuladorAction(CONV, '2026-10-11T12:00')).toEqual({ ok: true, data: { relogioOffsetSegundos: 6 * 86_400 - 2 * 3600 } })
      expect(m.definirRelogioSimulado).toHaveBeenLastCalledWith(db, { restaurantId: 'r1', userId: 'u1', conversationId: CONV, offsetSegundos: 6 * 86_400 - 2 * 3600 })
      expect(await a.relogioSimuladorAction(CONV, '2026-02-30T12:00')).toEqual({ ok: false, fieldErrors: { local: 'Essa data não existe.' } })
      expect(await a.relogioSimuladorAction(CONV, '2028-01-01T12:00')).toEqual({
        ok: false, fieldErrors: { local: 'Escolha uma data até um ano antes ou depois de hoje.' },
      })
      expect(await a.relogioSimuladorAction(CONV, null)).toEqual({ ok: true, data: { relogioOffsetSegundos: null } })
    } finally {
      vi.useRealTimers()
    }
  })

  it('detalhes: datas em texto', async () => {
    m.detalhesSimulacao.mockResolvedValue([{
      id: 1, etapa: 'triagem', modelo: 'm', promptVersion: 'v', intent: 'x', resultado: 'ok', erro: null,
      costUsd: '0.000100', latenciaMs: 812, itensValidos: 1, itensRespondidos: 1, createdAt: new Date('2026-10-05T17:00:00Z'),
    }])
    expect(await a.detalhesSimuladorAction(CONV)).toEqual({
      ok: true,
      data: [{ id: 1, etapa: 'triagem', modelo: 'm', promptVersion: 'v', intent: 'x', resultado: 'ok', erro: null, costUsd: '0.000100', latenciaMs: 812, itensValidos: 1, itensRespondidos: 1, criadaEm: '2026-10-05T17:00:00.000Z' }],
    })
  })
})
