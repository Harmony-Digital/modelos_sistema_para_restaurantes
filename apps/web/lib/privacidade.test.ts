import { describe, expect, it } from 'vitest'
import type { PedidoTitular, ResumoTitular } from '@atd/db'
import { contarPrazoLgpd, nomeArquivoResumo, situacaoPrazo, textoPrazo, textoResumo } from './privacidade'

const agora = new Date('2026-10-06T15:00:00Z')
const DIA = 86_400_000
const pedido = (over: Partial<PedidoTitular> = {}): PedidoTitular => ({
  id: '00000000-0000-4000-8000-000000000001', tipo: 'acesso', status: 'aberto', prazo: new Date(agora.getTime() + 10 * DIA),
  criadoEm: new Date(agora.getTime() - 5 * DIA), temCliente: true, resposta: null, resolvidoPor: null, ...over,
})

describe('prazo do pedido do titular', () => {
  it('mais de 3 dias: em dia', () => {
    expect(situacaoPrazo(pedido(), agora)).toBe('ok')
    expect(textoPrazo(pedido(), agora)).toBe('Faltam 10 dias')
  })

  it('3 dias ou menos: perto; arredonda para cima a fração de dia', () => {
    expect(situacaoPrazo(pedido({ prazo: new Date(agora.getTime() + 3 * DIA) }), agora)).toBe('perto')
    expect(textoPrazo(pedido({ prazo: new Date(agora.getTime() + 2.5 * DIA) }), agora)).toBe('Faltam 3 dias')
    expect(textoPrazo(pedido({ prazo: new Date(agora.getTime() + 2 * 3_600_000) }), agora)).toBe('Falta 1 dia')
    expect(situacaoPrazo(pedido({ prazo: new Date(agora.getTime() + 3 * DIA + 60_000) }), agora)).toBe('ok')
  })

  it('passou do prazo: vencido', () => {
    expect(situacaoPrazo(pedido({ prazo: new Date(agora.getTime() - 60_000) }), agora)).toBe('vencido')
    expect(textoPrazo(pedido({ prazo: new Date(agora.getTime() - 60_000) }), agora)).toBe('Prazo vencido')
    expect(textoPrazo(pedido({ prazo: new Date(agora.getTime() - 2.2 * DIA) }), agora)).toBe('Prazo vencido há 2 dias')
    expect(textoPrazo(pedido({ prazo: new Date(agora.getTime() - 1.5 * DIA) }), agora)).toBe('Prazo vencido há 1 dia')
  })

  it('pedido resolvido não tem prazo correndo', () => {
    const p = pedido({ status: 'concluido', prazo: new Date(agora.getTime() - 5 * DIA) })
    expect(situacaoPrazo(p, agora)).toBe('resolvido')
    expect(situacaoPrazo({ ...p, status: 'negado' }, agora)).toBe('resolvido')
  })

  it('contagem para o Início: só abertos perto ou vencidos', () => {
    const lista = [
      pedido(),
      pedido({ prazo: new Date(agora.getTime() + DIA) }),
      pedido({ status: 'em_andamento', prazo: new Date(agora.getTime() - DIA) }),
      pedido({ status: 'concluido', prazo: new Date(agora.getTime() - DIA) }),
    ]
    expect(contarPrazoLgpd(lista, agora)).toEqual({ perto: 1, vencidos: 1 })
    expect(contarPrazoLgpd([], agora)).toEqual({ perto: 0, vencidos: 0 })
  })
})

describe('texto do resumo de acesso', () => {
  const resumo: ResumoTitular = {
    pedidoId: '00000000-0000-4000-8000-000000000001',
    nomePerfil: 'Ana',
    primeiraInteracao: '2026-09-01T02:30:00Z',
    ultimaInteracao: '2026-10-05T18:00:00Z',
    conversas: 3,
    mensagens: 42,
    avisos: [
      { data: '2026-09-12', pessoas: 4, status: 'confirmada', unidade: 'Asa Sul', nome: 'Ana Lima', horario: '20:00', contatoInformado: true },
      { data: '2026-09-20', pessoas: 2, status: 'nao_veio', unidade: 'Asa Sul', nome: 'Ana', horario: '13:30', contatoInformado: false },
      // aviso antigo (antes da reserva com nome e horário)
      { data: '2026-08-02', pessoas: 3, status: 'cancelada', unidade: 'Asa Sul', nome: null, horario: null, contatoInformado: false },
    ],
    eventos: [{ data: '2026-11-20', convidados: 30, tipo: 'aniversario', status: 'confirmado', unidade: 'Asa Sul' }],
    pedidos: [{ tipo: 'acesso', status: 'aberto', criadoEm: '2026-10-01T12:00:00Z' }],
  }

  it('lista os dados no fuso do restaurante, sem telefone', () => {
    const t = textoResumo(resumo, 'America/Sao_Paulo')
    expect(t).toContain('Nome no WhatsApp: Ana')
    expect(t).toContain('Primeira interação: 31/08/2026')
    expect(t).toContain('Última interação: 05/10/2026')
    expect(t).toContain('Conversas: 3')
    expect(t).toContain('Mensagens: 42')
    expect(t).toContain('12/09/2026 · 20h · Asa Sul · 4 pessoas · em nome de Ana Lima · Confirmada · telefone de contato informado: sim')
    expect(t).toContain('20/09/2026 · 13h30 · Asa Sul · 2 pessoas · em nome de Ana · Não veio · telefone de contato informado: não')
    expect(t).toContain('02/08/2026 · Asa Sul · 3 pessoas · Cancelada · telefone de contato informado: não')
    expect(t).toContain('20/11/2026 · Asa Sul · Aniversário · 30 convidados · Confirmado')
    expect(t).toContain('Acesso aos dados · Aberto · 01/10/2026')
    // o número nunca aparece: só se foi informado
    expect(t).not.toMatch(/\d{4}-?\d{4}/)
    expect(t.match(/telefone/gi)).toHaveLength(3)
  })

  it('listas vazias e nome ausente ficam explícitos', () => {
    const t = textoResumo({ ...resumo, nomePerfil: null, avisos: [], eventos: [], pedidos: [] }, 'America/Sao_Paulo')
    expect(t).toContain('Nome no WhatsApp: não informado')
    expect(t).toContain('Reservas: nenhuma')
    expect(t).toContain('Pedidos de evento: nenhum')
  })

  it('nome do arquivo sem dado pessoal', () => {
    expect(nomeArquivoResumo(agora, 'America/Sao_Paulo')).toBe('resumo-de-dados-2026-10-06.txt')
  })
})
