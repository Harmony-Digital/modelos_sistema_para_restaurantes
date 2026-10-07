import { describe, expect, it, vi } from 'vitest'
import { redactPii } from '@atd/core'
import { parseTriageV6, parseTriageV7, triageV7, type LlmClient } from '../src/index.ts'
import { CASOS as CASOS_S1 } from './s1/casos.ts'
import { CASOS as CASOS_S2, FRASES as FRASES_S2 } from './s2/casos.ts'
import { CASOS as CASOS_S3, FRASES as FRASES_S3 } from './s3/casos.ts'
import { CASOS as CASOS_S4, FRASES as FRASES_S4 } from './s4/casos.ts'
import { chaveItemReserva, chaveItemS2, extracaoCorretaReserva } from './s2/comparar.ts'
import { CONTEXTO } from './s2/fixture.ts'
import { CASOS_RESERVA, type ItemV7, type RotuloReserva } from './s2/reserva.ts'

/**
 * Camada 2 (determinística) da triage-v7: sem LLM real. Garante que
 * - os gabaritos S1–S4 passam pela v7 com os mesmos itens da v6 (nome e contato_ok nulos);
 * - o gabarito da reserva é uma saída válida da v7, cobre os casos da spec e chega ao LLM sem PII;
 * - a comparação da camada 1 distingue nome e resposta do contato.
 */
const comNovos = <T extends object>(i: T) => ({ ...i, nome: null, contato_ok: null })
const grupos = { S1: CASOS_S1, S2: [...CASOS_S2, ...FRASES_S2], S3: [...CASOS_S3, ...FRASES_S3], S4: [...CASOS_S4, ...FRASES_S4] }

describe('gabaritos S1–S4 na triage-v7', () => {
  for (const [servico, casos] of Object.entries(grupos)) {
    it(`${servico}: ${casos.length} casos com os mesmos itens na v6 e na v7`, () => {
      expect(casos.length).toBeGreaterThan(0)
      for (const c of casos) {
        const v7 = parseTriageV7({ itens: c.itens.map(comNovos), fora_escopo: false, frustracao: false })
        const v6 = parseTriageV6({ itens: c.itens, fora_escopo: false, frustracao: false })
        expect(v7.itens, c.id).toEqual(v6.itens.map(comNovos))
      }
    })
  }
})

function fakeLlm(itens: ItemV7[]): LlmClient & { users: string[] } {
  const users: string[] = []
  return {
    users,
    completeJson: vi.fn(async (p) => {
      users.push(p.user)
      return { ok: true, data: p.parse({ itens, fora_escopo: false, frustracao: false }), model: 'm', usage: { tokensIn: 1, tokensOut: 1, tokensCache: 0, costUsd: '0' }, latencyMs: 1 }
    }) as LlmClient['completeJson'],
  }
}

describe('gabarito da reserva (triage-v7)', () => {
  it('cobre os casos da spec, com ids únicos', () => {
    const exigidos: RotuloReserva[] = ['cabe', 'lotado', 'contato_sim', 'contato_nao', 'numero_novo', 'nome', 'cancelar', 'mais_de_60', 'mudar', 'intencao', 'nao_e_reserva']
    const rotulos = new Set(CASOS_RESERVA.map((c) => c.rotulo))
    for (const r of exigidos) expect(rotulos, r).toContain(r)
    expect(new Set(CASOS_RESERVA.map((c) => c.id)).size).toBe(CASOS_RESERVA.length)
  })

  for (const caso of CASOS_RESERVA) {
    it(`${caso.id} (${caso.rotulo}): ${caso.mensagem}`, async () => {
      // o gabarito é uma saída válida da v7, sem perda
      const llm = fakeLlm(caso.itens)
      const r = await triageV7(llm, { models: ['m'], restaurante: CONTEXTO.restaurante, text: caso.mensagem, ...(caso.pendente ? { pendente: caso.pendente } : {}) })
      expect(r.ok && r.data.itens).toEqual(caso.itens)
      // o LLM vê a mensagem redigida e o pendente antes dela
      const user = llm.users[0]!
      expect(user).toContain(redactPii(caso.mensagem))
      if (caso.pendente) expect(user.indexOf('<pergunta_pendente>')).toBeLessThan(user.indexOf('<mensagem_cliente>'))
      // nome e contato_ok só na reserva
      for (const i of caso.itens) if (i.servico !== 'aviso_presenca') expect([i.nome, i.contato_ok]).toEqual([null, null])
      expect(extracaoCorretaReserva(caso.itens, r.ok ? r.data.itens : [], CONTEXTO, new Date(caso.agora))).toBe(true)
    })
  }

  it('número novo: o telefone nunca chega ao LLM, só [TELEFONE]', async () => {
    const casos = CASOS_RESERVA.filter((c) => c.rotulo === 'numero_novo')
    expect(casos.length).toBeGreaterThanOrEqual(2)
    for (const caso of casos) {
      const llm = fakeLlm(caso.itens)
      await triageV7(llm, { models: ['m'], restaurante: 'Casa X', text: caso.mensagem, pendente: caso.pendente! })
      expect(llm.users[0], caso.id).toContain('[TELEFONE]')
      expect(llm.users[0], caso.id).not.toMatch(/\d{4}-?\d{4}/)
      expect(caso.itens.every((i) => i.contato_ok === false), caso.id).toBe(true)
    }
  })

  it('mais de 60: o número é extraído como o cliente disse, no serviço da reserva', () => {
    for (const caso of CASOS_RESERVA.filter((c) => c.rotulo === 'mais_de_60')) {
      expect(caso.itens[0]).toMatchObject({ servico: 'aviso_presenca', tipo: 'registrar' })
      expect(caso.itens[0]!.pessoas).toBeGreaterThan(60)
    }
  })
})

describe('comparação da camada 1 com nome e contato', () => {
  const agora = new Date('2026-10-05T14:00:00-03:00')
  const base = CASOS_RESERVA.find((c) => c.id === 'rv01')!.itens[0]!
  const k = (i: ItemV7) => chaveItemReserva(i, CONTEXTO, agora)
  it('nome sem acento nem caixa e espaços extras é o mesmo', () => {
    expect(k({ ...base, nome: 'Joao  da Silva' })).toBe(k({ ...base, nome: 'joão da silva' }))
  })
  it('nome diferente, nome ausente ou contato diferente mudam a extração', () => {
    for (const outro of [{ nome: 'Bia' }, { nome: null }, { contato_ok: true }, { contato_ok: false }]) expect(k({ ...base, ...outro })).not.toBe(k(base))
  })
  it('fora da reserva a chave é a do S2', () => {
    const can = CASOS_RESERVA.find((c) => c.id === 'rv20')!.itens[0]!
    const info = CASOS_RESERVA.find((c) => c.id === 'rv24')!.itens[0]!
    expect(k(can)).toBe(chaveItemS2(can, CONTEXTO, agora))
    expect(k(info)).toBe(chaveItemS2(info, CONTEXTO, agora))
  })
})
