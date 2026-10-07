import { describe, expect, it } from 'vitest'
import {
  acoesDaReserva, alternarStatus, diaDaAgenda, horaDaReserva, horarioDoAviso, hrefAgenda, hrefDaAgendaAntiga, inicioDaAgenda, limiteDaAgenda, linhaDoTempo, pendentesForaDoDia,
  resumoDoDia, statusDaAgenda, statusDaFila, textoOcupacao,
} from './agenda'

const U1 = '00000000-0000-4000-8000-000000000001'
const U2 = '00000000-0000-4000-8000-000000000002'
const aviso = (over = {}) => ({
  id: crypto.randomUUID(), unitId: U1, nome: 'Ana', pessoas: 4, horarioAprox: '20:00' as string | null, horario: null as string | null,
  origem: 'ia' as const, status: 'confirmada' as 'confirmada' | 'cancelada' | 'nao_veio', simulado: false, temContato: false, ...over,
})
const LOT = { capacidade: null, ocupadas: 0, ocupadasSimulacao: 0 }
const pedido = (over = {}) => ({
  id: crypto.randomUUID(), unitId: U1, unidade: 'Asa Sul', spaceId: null, espaco: null, nome: 'Caio', data: '2026-10-05',
  convidados: 30, tipo: 'aniversario' as const, tipoTexto: null, observacoes: null, status: 'novo' as 'novo' | 'em_contato' | 'confirmado' | 'recusado' | 'cancelado',
  responsavelId: null, responsavel: null, notasInternas: null, temTelefone: true, simulado: false, criadoEm: new Date('2026-10-01T12:00:00Z'), ...over,
})

describe('agenda: dia e links', () => {
  it('dia da URL: inválido volta para hoje; fora de hoje ± 365 vai para o limite', () => {
    expect(diaDaAgenda(undefined, '2026-10-05')).toBe('2026-10-05')
    expect(diaDaAgenda('lixo', '2026-10-05')).toBe('2026-10-05')
    expect(diaDaAgenda('2026-12-20', '2026-10-05')).toBe('2026-12-20')
    expect(diaDaAgenda('2020-01-01', '2026-10-05')).toBe(inicioDaAgenda('2026-10-05'))
    expect(diaDaAgenda('2030-01-01', '2026-10-05')).toBe(limiteDaAgenda('2026-10-05'))
    expect(inicioDaAgenda('2026-10-05')).toBe('2025-10-05')
    expect(limiteDaAgenda('2026-10-05')).toBe('2027-10-05')
  })

  it('hrefAgenda omite o dia de hoje e o que está vazio', () => {
    expect(hrefAgenda({ dia: '2026-10-05', hoje: '2026-10-05' })).toBe('/agenda')
    expect(hrefAgenda({ dia: '2026-10-06', hoje: '2026-10-05', unidade: U1, cancelados: true, pedido: 'p1' }))
      .toBe(`/agenda?dia=2026-10-06&unidade=${U1}&cancelados=1&pedido=p1`)
    expect(hrefAgenda({ dia: '2026-10-05', hoje: '2026-10-05', unidade: null, cancelados: false, pedido: null })).toBe('/agenda')
  })

  it('hrefAgenda da lista de todos os pedidos: ver=pedidos e o filtro de status só quando não é o padrão', () => {
    expect(hrefAgenda({ dia: '2026-10-05', hoje: '2026-10-05', ver: 'pedidos' })).toBe('/agenda?ver=pedidos')
    expect(hrefAgenda({ dia: '2026-10-05', hoje: '2026-10-05', ver: 'pedidos', status: ['novo', 'em_contato'] })).toBe('/agenda?ver=pedidos')
    expect(hrefAgenda({ dia: '2026-10-05', hoje: '2026-10-05', unidade: U1, ver: 'pedidos', status: ['confirmado', 'novo'], pedido: 'p1' }))
      .toBe(`/agenda?unidade=${U1}&ver=pedidos&status=novo%2Cconfirmado&pedido=p1`)
    // no dia, o filtro de status não vai na URL
    expect(hrefAgenda({ dia: '2026-10-05', hoje: '2026-10-05', ver: 'dia', status: ['confirmado'] })).toBe('/agenda')
  })

  it('filtro de status da lista: padrão novo + em contato; ignora lixo; alternar nunca deixa vazio', () => {
    expect(statusDaFila(undefined)).toEqual(['novo', 'em_contato'])
    expect(statusDaFila('confirmado,lixo,novo')).toEqual(['novo', 'confirmado'])
    expect(statusDaFila('lixo')).toEqual(['novo', 'em_contato'])
    expect(alternarStatus(['novo'], 'confirmado')).toEqual(['novo', 'confirmado'])
    expect(alternarStatus(['novo', 'confirmado'], 'novo')).toEqual(['confirmado'])
    expect(alternarStatus(['novo'], 'novo')).toEqual(['novo'])
  })

  it('endereço antigo (?aba, ?data) vira o novo preservando dia, unidade, cancelados, pedido e o filtro de status', () => {
    expect(hrefDaAgendaAntiga({})).toBeNull()
    expect(hrefDaAgendaAntiga({ dia: '2026-10-06', unidade: U1 })).toBeNull()
    expect(hrefDaAgendaAntiga({ aba: 'previsao' })).toBe('/agenda')
    expect(hrefDaAgendaAntiga({ aba: 'previsao', data: '2026-10-06', unidade: U1, cancelados: '1' }))
      .toBe(`/agenda?dia=2026-10-06&unidade=${U1}&cancelados=1`)
    // a aba Eventos antiga vira a lista de todos os pedidos, com o mesmo filtro de status
    expect(hrefDaAgendaAntiga({ aba: 'eventos' })).toBe('/agenda?ver=pedidos')
    expect(hrefDaAgendaAntiga({ aba: 'eventos', unidade: U1, status: 'novo,confirmado' })).toBe(`/agenda?unidade=${U1}&ver=pedidos&status=novo%2Cconfirmado`)
    expect(hrefDaAgendaAntiga({ data: '2026-10-06' })).toBe('/agenda?dia=2026-10-06')
    // data inválida não vai adiante; o dia novo vence o antigo
    expect(hrefDaAgendaAntiga({ aba: 'previsao', data: 'lixo' })).toBe('/agenda')
    expect(hrefDaAgendaAntiga({ aba: 'eventos', dia: '2026-10-07', data: '2026-10-06', pedido: 'p1' })).toBe('/agenda?dia=2026-10-07&ver=pedidos&pedido=p1')
  })

  it('status dos pedidos: sem cancelados, só os que estão de pé; com cancelados, todos', () => {
    expect(statusDaAgenda(false)).toEqual(['novo', 'em_contato', 'confirmado'])
    expect(statusDaAgenda(true)).toEqual(['novo', 'em_contato', 'confirmado', 'recusado', 'cancelado'])
  })
})

describe('agenda: linha do tempo', () => {
  const unidades = [
    { unitId: U1, unidade: 'Asa Sul', totalPessoas: 0, ...LOT, avisos: [
      aviso({ nome: 'sem hora', horarioAprox: null }), aviso({ nome: 'tarde', horarioAprox: '20:30' }), aviso({ nome: 'cedo', horarioAprox: '12:00' }),
    ] },
    { unitId: U2, unidade: 'Lago Sul', totalPessoas: 0, ...LOT, avisos: [aviso({ unitId: U2, nome: 'lago', horarioAprox: '19:00' })] },
  ]
  const pedidos = [
    pedido({ nome: 'evento hoje' }),
    pedido({ nome: 'evento lago', unitId: U2, unidade: 'Lago Sul' }),
    pedido({ nome: 'evento outro dia', data: '2026-10-10' }),
  ]

  it('junta pedidos do dia (dia todo, primeiro) e avisos por horário; sem horário no fim', () => {
    const itens = linhaDoTempo(unidades, pedidos, { dia: '2026-10-05', unidade: null })
    expect(itens.map((i) => (i.tipo === 'evento' ? i.pedido.nome : i.aviso.nome))).toEqual([
      'evento hoje', 'evento lago', 'cedo', 'lago', 'tarde', 'sem hora',
    ])
    expect(itens.find((i) => i.tipo === 'aviso' && i.aviso.nome === 'lago')).toMatchObject({ unidade: 'Lago Sul' })
  })

  it('filtra pela unidade', () => {
    const itens = linhaDoTempo(unidades, pedidos, { dia: '2026-10-05', unidade: U2 })
    expect(itens.map((i) => (i.tipo === 'evento' ? i.pedido.nome : i.aviso.nome))).toEqual(['evento lago', 'lago'])
  })

  it('horário com segundos ordena igual', () => {
    const us = [{ unitId: U1, unidade: 'Asa Sul', totalPessoas: 0, ...LOT, avisos: [aviso({ nome: 'b', horarioAprox: '21:00:00' }), aviso({ nome: 'a', horarioAprox: '09:15' })] }]
    expect(linhaDoTempo(us, [], { dia: '2026-10-05', unidade: null }).map((i) => i.tipo === 'aviso' && i.aviso.nome)).toEqual(['a', 'b'])
  })

  it('horário livre ("à noite") aparece inteiro e vai depois dos "HH:MM", na ordem estável', () => {
    const us = [{ unitId: U1, unidade: 'Asa Sul', totalPessoas: 0, ...LOT, avisos: [
      aviso({ nome: 'noite', horarioAprox: 'à noite' }),
      aviso({ nome: 'tarde', horarioAprox: '20:30' }),
      aviso({ nome: 'jantar', horarioAprox: 'no jantar' }),
      aviso({ nome: 'sem', horarioAprox: null }),
      aviso({ nome: 'almoço', horarioAprox: '12:00' }),
      aviso({ nome: 'aaa', horarioAprox: 'antes das 9' }),
    ] }]
    expect(linhaDoTempo(us, [], { dia: '2026-10-05', unidade: null }).map((i) => i.tipo === 'aviso' && i.aviso.nome))
      .toEqual(['almoço', 'tarde', 'noite', 'jantar', 'aaa', 'sem'])
    expect(horarioDoAviso('à noite')).toBe('à noite')
    expect(horarioDoAviso('no fim da tarde')).toBe('no fim da tarde')
    expect(horarioDoAviso('20:30:00')).toBe('20:30')
    expect(horarioDoAviso('20:30')).toBe('20:30')
    expect(horarioDoAviso(null)).toBeNull()
  })

  it('resumo: pessoas só de avisos ativos, contagem de avisos ativos e de eventos do dia', () => {
    const us = [{ unitId: U1, unidade: 'Asa Sul', totalPessoas: 6, ...LOT, avisos: [aviso({ pessoas: 6 }), aviso({ pessoas: 3, status: 'cancelada' })] }]
    const itens = linhaDoTempo(us, [pedido()], { dia: '2026-10-05', unidade: null })
    expect(resumoDoDia(itens)).toEqual({ pessoas: 6, reservas: 1, eventos: 1 })
  })

  it('pendentes em outros dias: só novos/em contato fora do dia, em ordem de data', () => {
    const ps = [
      pedido({ nome: 'hoje' }),
      pedido({ nome: 'depois', data: '2026-10-20' }),
      pedido({ nome: 'antes', data: '2026-10-08', status: 'em_contato' }),
      pedido({ nome: 'confirmado', data: '2026-10-09', status: 'confirmado' }),
    ]
    expect(pendentesForaDoDia(ps, '2026-10-05').map((p) => p.nome)).toEqual(['antes', 'depois'])
  })
})

describe('agenda: reservas', () => {
  it('hrefAgenda abre a reserva pela URL (?reserva=), sem o pedido junto', () => {
    expect(hrefAgenda({ dia: '2026-10-06', hoje: '2026-10-05', unidade: U1, reserva: 'r1' })).toBe(`/agenda?dia=2026-10-06&unidade=${U1}&reserva=r1`)
    expect(hrefAgenda({ dia: '2026-10-05', hoje: '2026-10-05', reserva: null })).toBe('/agenda')
  })

  it('hora da reserva: o horário marcado vale; o horário aproximado antigo só quando não há', () => {
    expect(horaDaReserva({ horario: '20:30:00', horarioAprox: 'à noite' })).toBe('20:30:00')
    expect(horaDaReserva({ horario: null, horarioAprox: 'à noite' })).toBe('à noite')
    expect(horaDaReserva({ horario: null, horarioAprox: null })).toBeNull()
    const us = [{ unitId: U1, unidade: 'Asa Sul', totalPessoas: 0, capacidade: null, ocupadas: 0, ocupadasSimulacao: 0, avisos: [
      aviso({ nome: 'nova 19h', horario: '19:00:00', horarioAprox: null }),
      aviso({ nome: 'antiga 18h', horario: null, horarioAprox: '18:00' }),
      aviso({ nome: 'nova 21h', horario: '21:00:00', horarioAprox: '08:00' }),
    ] }]
    expect(linhaDoTempo(us, [], { dia: '2026-10-05', unidade: null }).map((i) => i.tipo === 'aviso' && i.aviso.nome))
      .toEqual(['antiga 18h', 'nova 19h', 'nova 21h'])
  })

  it('ocupação: "147/150" ou "sem limite"', () => {
    expect(textoOcupacao({ capacidade: 150, ocupadas: 147 })).toBe('147/150')
    expect(textoOcupacao({ capacidade: null, ocupadas: 12 })).toBe('sem limite')
  })

  it('ações: confirmada e cancelada de hoje em diante; não veio só no dia ou depois; nunca a situação atual', () => {
    const hoje = '2026-10-05'
    expect(acoesDaReserva('confirmada', '2026-10-06', hoje)).toEqual(['cancelada'])
    expect(acoesDaReserva('confirmada', hoje, hoje)).toEqual(['cancelada', 'nao_veio'])
    expect(acoesDaReserva('confirmada', '2026-10-04', hoje)).toEqual(['nao_veio'])
    expect(acoesDaReserva('cancelada', '2026-10-06', hoje)).toEqual(['confirmada'])
    expect(acoesDaReserva('cancelada', '2026-10-04', hoje)).toEqual(['nao_veio'])
    expect(acoesDaReserva('nao_veio', hoje, hoje)).toEqual(['confirmada', 'cancelada'])
    expect(acoesDaReserva('nao_veio', '2026-10-04', hoje)).toEqual([])
  })
})
