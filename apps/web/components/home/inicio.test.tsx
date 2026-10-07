import { act, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgendaHoje } from './agenda-hoje'
import { AlertasInicio } from './alertas-inicio'
import { EsperaAoVivo } from './espera-ao-vivo'
import { Indicador } from './indicador'
import { Minigrafico } from './minigrafico'
import type { LinhaAgendaHoje } from '@/lib/inicio'

afterEach(() => vi.useRealTimers())

describe('Minigrafico', () => {
  it('desenha a série em SVG e descreve os valores para leitor de tela', () => {
    render(<Minigrafico valores={[1, 3, 2]} descricao="Conversas nos últimos 7 dias" rotulos={['1', '3', '2']} />)
    const img = screen.getByRole('img', { name: 'Conversas nos últimos 7 dias: 1, 3, 2' })
    expect(img.tagName.toLowerCase()).toBe('svg')
    expect(img.querySelector('polyline')?.getAttribute('points')).toBeTruthy()
  })
  it('sem série não desenha nada', () => {
    const { container } = render(<Minigrafico valores={[]} descricao="x" rotulos={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('Indicador', () => {
  it('rótulo e valor juntos para leitor de tela, valor em mono tabular, link para a tela certa', () => {
    render(<Indicador rotulo="Aguardando" valor="3" dica="12 conversas abertas" href="/conversas" />)
    const g = screen.getByRole('group', { name: 'Aguardando: 3' })
    expect(within(g).getByText('3')).toHaveAttribute('data-slot', 'numero')
    expect(within(g).getByText('12 conversas abertas')).toBeInTheDocument()
    expect(within(g).getByRole('link', { name: /Aguardando/ })).toHaveAttribute('href', '/conversas')
  })
  it('com série, mostra o mini-gráfico; sem link, não vira link', () => {
    render(<Indicador rotulo="Gasto IA hoje" valor="R$ 4,10" serie={{ valores: [1, 2], rotulos: ['R$ 1', 'R$ 2'], descricao: 'Gasto nos últimos 7 dias' }} />)
    expect(screen.getByRole('img', { name: 'Gasto nos últimos 7 dias: R$ 1, R$ 2' })).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })
  it('estado de alerta não depende só de cor: ícone ao lado do valor', () => {
    const { container, unmount } = render(<Indicador rotulo="Aguardando" valor="2" tom="alerta" />)
    expect(container.querySelector('[data-slot="alerta"]')).not.toBeNull()
    unmount()
    const neutro = render(<Indicador rotulo="Aguardando" valor="0" />)
    expect(neutro.container.querySelector('[data-slot="alerta"]')).toBeNull()
  })
  it('valor longo quebra em vez de vazar (celular)', () => {
    render(<Indicador rotulo="X" valor="R$ 1.234.567,89" />)
    expect(screen.getByText('R$ 1.234.567,89').className).toMatch(/break-all|break-words|wrap-anywhere/)
    expect(screen.getByRole('group').className).toMatch(/min-w-0/)
  })
})

describe('EsperaAoVivo', () => {
  it('conta mm:ss a partir de "desde" e avança a cada segundo', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-07T12:00:00Z'))
    render(<EsperaAoVivo desde={new Date('2026-10-07T11:57:55Z')} />)
    expect(screen.getByText('02:05')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByText('02:06')).toBeInTheDocument()
    expect(screen.getByText('02:06').closest('time')).toHaveAttribute('datetime', '2026-10-07T11:57:55.000Z')
  })
})

const linhas: LinhaAgendaHoje[] = [
  { tipo: 'reserva', id: 'a1', hora: '20:00', titulo: '6 pessoas', detalhe: 'Ana', unidade: 'Asa Sul', simulado: false, href: '/agenda?dia=2026-10-07&reserva=a1' },
  { tipo: 'evento', id: 'p1', hora: null, titulo: 'Aniversário · 30 convidados', detalhe: 'Bia', unidade: 'Asa Norte', simulado: true, href: '/agenda?dia=2026-10-07&pedido=p1', status: 'novo' },
]

describe('AgendaHoje', () => {
  it('cada linha leva à Agenda já no item; evento com etiqueta do status; simulado com selo', () => {
    render(<AgendaHoje linhas={linhas} hoje="2026-10-07" />)
    const tabela = screen.getByRole('table', { name: 'Agenda de hoje' })
    expect(within(tabela).getByRole('columnheader', { name: 'Reserva ou evento' })).toBeInTheDocument()
    const reserva = within(tabela).getByRole('link', { name: /6 pessoas/ })
    expect(reserva).toHaveAttribute('href', '/agenda?dia=2026-10-07&reserva=a1')
    expect(within(tabela).getByText('20:00')).toBeInTheDocument()
    const evento = within(tabela).getByRole('link', { name: /Aniversário/ })
    expect(evento).toHaveAttribute('href', '/agenda?dia=2026-10-07&pedido=p1')
    const linhaEvento = evento.closest('tr')!
    expect(within(linhaEvento).getByText('Novo')).toHaveAttribute('data-variante', 'novo')
    expect(within(linhaEvento).getByText('Simulação')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Abrir agenda' })).toHaveAttribute('href', '/agenda?dia=2026-10-07')
  })
  it('horário livre ("no fim da tarde") quebra linha em vez de alargar a coluna', () => {
    const livre = { ...linhas[0]!, id: 'livre', hora: 'no fim da tarde' } as LinhaAgendaHoje
    render(<AgendaHoje linhas={[livre]} hoje="2026-10-07" />)
    const celula = screen.getByText('no fim da tarde').closest('td')!
    expect(celula.className).not.toMatch(/whitespace-nowrap/)
    expect(screen.getByText('no fim da tarde').className).toMatch(/break-words/)
  })
  it('dia vazio', () => {
    render(<AgendaHoje linhas={[]} hoje="2026-10-07" />)
    expect(screen.getByText('Nenhuma reserva ou evento para hoje')).toBeInTheDocument()
  })
})

describe('AlertasInicio', () => {
  const vazio = { gastos: [], pedidosLgpd: [], importacoesParadas: [], lacunas: [], agora: new Date('2026-10-07T12:00:00Z') }
  it('sem nada pendente: diz que está tudo em dia', () => {
    render(<AlertasInicio {...vazio} />)
    expect(screen.getByRole('region', { name: 'Alertas' })).toHaveTextContent('Nenhum alerta agora')
  })
  it('importação parada leva à leitura dela; pergunta sem resposta leva à lista para responder', () => {
    render(<AlertasInicio
      {...vazio}
      importacoesParadas={[{ id: 'imp-1', alvo: 'cardapio' }, { id: 'imp-2', alvo: 'horarios' }]}
      lacunas={[{ id: 'l1', chave: 'estacionamento', unidade: null, ocorrencias: 2 }]}
    />)
    const regiao = screen.getByRole('region', { name: 'Alertas' })
    expect(regiao).not.toHaveTextContent('Nenhum alerta agora')
    expect(within(regiao).getByRole('link', { name: /Cardápio/ })).toHaveAttribute('href', '/conteudo?aba=cardapio&importar=1&imp=imp-1')
    expect(within(regiao).getByRole('link', { name: /Horários/ })).toHaveAttribute('href', '/unidades/importar?alvo=horarios&imp=imp-2')
    expect(within(regiao).getByRole('region', { name: 'Perguntas sem resposta' })).toBeInTheDocument()
  })
  it('prazo LGPD e alerta de gasto reaproveitam os cartões atuais', () => {
    render(<AlertasInicio
      {...vazio}
      pedidosLgpd={[{ prazo: new Date('2026-10-01T00:00:00Z'), status: 'aberto' }]}
      gastos={[{ escopo: 'ia', periodo: 'dia', nivel: 80, inicioPeriodo: '2026-10-07', usoUsd: '0.9', limiteUsd: '1', criadoEm: new Date(), limiteAlteradoDepois: false }]}
    />)
    expect(screen.getByRole('region', { name: /Pedidos de privacidade/ })).toHaveTextContent('1 pedido vencido')
    expect(screen.getByRole('region', { name: /Alertas de gasto/ })).toBeInTheDocument()
  })
})
