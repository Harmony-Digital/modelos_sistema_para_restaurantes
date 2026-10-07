import { describe, expect, it } from 'vitest'
import type { AvisoPainel, PedidoPainel, PrevisaoUnidade } from '@atd/db'
import { agendaDeHoje, cronometro, hrefAvisosDoDia, hrefPedido, importacoesParadas, percentual, pontosDoGrafico } from './inicio'

describe('percentual', () => {
  it('sem perguntas mostra traço; arredonda', () => {
    expect(percentual(0, 0)).toBe('—')
    expect(percentual(2, 3)).toBe('67%')
    expect(percentual(5, 5)).toBe('100%')
  })
})

describe('cronometro', () => {
  it('mm:ss abaixo de uma hora; h:mm:ss acima; nunca negativo', () => {
    expect(cronometro(0)).toBe('00:00')
    expect(cronometro(5)).toBe('00:05')
    expect(cronometro(65.9)).toBe('01:05')
    expect(cronometro(59 * 60 + 59)).toBe('59:59')
    expect(cronometro(3600)).toBe('1:00:00')
    expect(cronometro(2 * 3600 + 61)).toBe('2:01:01')
    expect(cronometro(-30)).toBe('00:00')
  })
})

describe('pontosDoGrafico', () => {
  it('escala para a caixa (y invertido), série constante fica no chão', () => {
    expect(pontosDoGrafico([0, 5, 10], 100, 20)).toBe('0,20 50,10 100,0')
    expect(pontosDoGrafico([3, 3], 100, 20)).toBe('0,20 100,20')
    expect(pontosDoGrafico([7], 100, 20)).toBe('0,20 100,20')
    expect(pontosDoGrafico([], 100, 20)).toBe('')
  })
})

describe('links do Início', () => {
  it('aviso abre a Agenda no dia e na unidade; pedido abre o pedido na Agenda do dia dele', () => {
    expect(hrefAvisosDoDia('2026-10-07', 'u 1')).toBe('/agenda?dia=2026-10-07&unidade=u%201')
    expect(hrefPedido({ id: 'p1', data: '2026-10-07' })).toBe('/agenda?dia=2026-10-07&pedido=p1')
  })
})

const aviso = (p: Partial<AvisoPainel>): AvisoPainel => ({
  id: 'a', unitId: 'u1', nome: 'Ana', pessoas: 4, horarioAprox: null, origem: 'ia', status: 'ativo', simulado: false, ...p,
})
const pedido = (p: Partial<PedidoPainel>): PedidoPainel => ({
  id: 'p', unitId: 'u1', unidade: 'Asa Sul', spaceId: null, espaco: null, nome: 'Bia', data: '2026-10-07', convidados: 30,
  tipo: 'aniversario', tipoTexto: null, observacoes: null, status: 'novo', responsavelId: null, responsavel: null,
  notasInternas: null, temTelefone: true, simulado: false, criadoEm: new Date('2026-10-01T12:00:00Z'), ...p,
})

describe('agendaDeHoje', () => {
  it('junta avisos ativos e pedidos de evento do dia (fora recusados/cancelados), por horário, com o link certo', () => {
    const previsao: PrevisaoUnidade[] = [
      { unitId: 'u1', unidade: 'Asa Sul', totalPessoas: 10, avisos: [
        aviso({ id: 'a1', horarioAprox: '20:00', pessoas: 6 }),
        aviso({ id: 'a2', horarioAprox: null, nome: null }),
        aviso({ id: 'a3', status: 'cancelado' }),
      ] },
      { unitId: 'u2', unidade: 'Asa Norte', totalPessoas: 2, avisos: [aviso({ id: 'a4', unitId: 'u2', horarioAprox: '12h30', pessoas: 2, simulado: true })] },
    ]
    const pedidos = [
      pedido({ id: 'p1' }),
      pedido({ id: 'p2', data: '2026-10-08' }),
      pedido({ id: 'p3', status: 'recusado' }),
      pedido({ id: 'p4', status: 'confirmado', unidade: 'Asa Norte', tipo: 'outro', tipoTexto: 'Formatura' }),
    ]
    const linhas = agendaDeHoje(previsao, pedidos, '2026-10-07')
    expect(linhas.map((l) => l.id)).toEqual(['a4', 'a1', 'a2', 'p1', 'p4'])
    expect(linhas[0]).toMatchObject({ tipo: 'aviso', hora: '12h30', titulo: '2 pessoas', unidade: 'Asa Norte', simulado: true, href: '/agenda?dia=2026-10-07&unidade=u2' })
    expect(linhas[2]).toMatchObject({ hora: null, titulo: '4 pessoas', detalhe: 'Sem nome' })
    expect(linhas[1]).toMatchObject({ detalhe: 'Ana' })
    expect(linhas[3]).toMatchObject({ tipo: 'evento', status: 'novo', titulo: 'Aniversário · 30 convidados', href: '/agenda?dia=2026-10-07&pedido=p1' })
    expect(linhas[4]).toMatchObject({ status: 'confirmado', titulo: 'Formatura · 30 convidados', unidade: 'Asa Norte' })
  })

  it('1 pessoa no singular', () => {
    const l = agendaDeHoje([{ unitId: 'u1', unidade: 'A', totalPessoas: 1, avisos: [aviso({ pessoas: 1 })] }], [], '2026-10-07')
    expect(l[0]!.titulo).toBe('1 pessoa')
  })
})

describe('importacoesParadas', () => {
  const agora = new Date('2026-10-07T12:00:00Z')
  const base = { recebendo: false, atualizadoEm: new Date('2026-10-07T11:40:00Z') }
  it('lendo sem mudança há mais de 10 min (e não recebendo arquivos) é parada; o resto não', () => {
    const lista = [
      { ...base, id: 'i1', status: 'processando' as const },
      { ...base, id: 'i2', status: 'enviado' as const },
      { ...base, id: 'i3', status: 'enviado' as const, recebendo: true },
      { ...base, id: 'i4', status: 'processando' as const, atualizadoEm: new Date('2026-10-07T11:55:00Z') },
      { ...base, id: 'i5', status: 'rascunho' as const },
      { ...base, id: 'i6', status: 'erro' as const },
    ]
    expect(importacoesParadas(lista, agora).map((i) => i.id)).toEqual(['i1', 'i2'])
  })
})
