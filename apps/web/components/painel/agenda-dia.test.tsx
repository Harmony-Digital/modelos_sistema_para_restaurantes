import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const push = vi.fn()
const replace = vi.fn()
const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace, refresh }), usePathname: () => '/agenda' }))
const criarReservaAction = vi.fn()
const mudarStatusReservaAction = vi.fn()
const revelarContatoReservaAction = vi.fn()
vi.mock('@/app/(painel)/agenda/actions', () => ({ criarReservaAction, mudarStatusReservaAction, revelarContatoReservaAction }))
const atualizarPedidoAction = vi.fn()
const revelarTelefoneAction = vi.fn()
vi.mock('@/app/(painel)/agenda/eventos-actions', () => ({ atualizarPedidoAction, revelarTelefoneAction }))
const toastErro = vi.fn()
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: toastErro } }))

const { AgendaDia } = await import('./agenda-dia')

const U1 = '00000000-0000-4000-8000-000000000001'
const U2 = '00000000-0000-4000-8000-000000000002'
const M1 = '00000000-0000-4000-8000-0000000000b1'
const P1 = '00000000-0000-4000-8000-0000000000aa'
const aviso = (over = {}) => ({
  id: crypto.randomUUID(), unitId: U1, nome: 'Ana', pessoas: 4, horarioAprox: '20:00' as string | null, horario: null as string | null,
  origem: 'ia' as 'ia' | 'painel', status: 'confirmada' as 'confirmada' | 'cancelada' | 'nao_veio', simulado: false, temContato: true, ...over,
})
const pedido = (over = {}) => ({
  id: P1, unitId: U1, unidade: 'Asa Sul', spaceId: null, espaco: 'Salão Jardim' as string | null, nome: 'Caio' as string | null, data: '2026-10-05',
  convidados: 30, tipo: 'aniversario' as const, tipoTexto: null, observacoes: 'Sem glúten', status: 'novo' as 'novo' | 'em_contato' | 'confirmado' | 'recusado' | 'cancelado',
  responsavelId: null, responsavel: null, notasInternas: null, temTelefone: true, simulado: false, criadoEm: new Date('2026-10-05T12:00:00Z'), ...over,
})
const lot = { capacidade: null as number | null, ocupadas: 0, ocupadasSimulacao: 0 }
const R1 = '00000000-0000-4000-8000-0000000000c1'
const unidades = [
  {
    unitId: U1, unidade: 'Asa Sul', totalPessoas: 6, capacidade: 150 as number | null, ocupadas: 147, ocupadasSimulacao: 0,
    avisos: [aviso({ id: R1, horarioAprox: '20:00' }), aviso({ nome: null, pessoas: 2, horarioAprox: '12:30', origem: 'painel' })],
  },
  { unitId: U2, unidade: 'Lago Sul', totalPessoas: 0, ...lot, avisos: [] },
]
const base = {
  dia: '2026-10-05', hoje: '2026-10-05', unidades, pedidos: [pedido()], unidade: null as string | null, cancelados: false,
  pedidoId: null as string | null, reservaId: null as string | null, membros: [{ id: M1, nome: 'Bia', todas: true, unidades: [] }], podeEditar: true,
  agora: new Date('2026-10-05T15:00:00Z'), ver: 'dia' as 'dia' | 'pedidos', status: ['novo', 'em_contato'] as StatusPedidoTeste[], novos: 0,
}
type StatusPedidoTeste = 'novo' | 'em_contato' | 'confirmado' | 'recusado' | 'cancelado'
const linhas = () => within(screen.getByRole('list', { name: 'Linha do tempo do dia' })).getAllByRole('listitem')

const matchMediaOriginal = window.matchMedia
function comoDesktop() {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('1024'), media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

beforeEach(() => {
  vi.clearAllMocks()
  atualizarPedidoAction.mockResolvedValue({ ok: true, data: null })
})
afterEach(() => {
  window.matchMedia = matchMediaOriginal
})

describe('AgendaDia: linha do tempo', () => {
  it('junta o pedido de evento (dia todo) e os avisos por horário, com resumo do dia', () => {
    render(<AgendaDia {...base} />)
    const l = linhas()
    expect(l).toHaveLength(3)
    expect(l[0]).toHaveTextContent('Dia todo')
    expect(l[0]).toHaveTextContent('Caio')
    expect(l[0]).toHaveTextContent('Novo')
    expect(l[0]).toHaveTextContent('30 convidados · aniversário')
    expect(l[1]).toHaveTextContent('12:30')
    expect(l[1]).toHaveTextContent('Sem nome')
    expect(l[1]).toHaveTextContent('Painel')
    expect(l[2]).toHaveTextContent('20:00')
    expect(l[2]).toHaveTextContent('Ana')
    expect(l[2]).toHaveTextContent('IA')
    expect(screen.getByText('Hoje · Segunda-feira, 05/10/2026')).toBeInTheDocument()
    expect(screen.getByTestId('resumo-do-dia')).toHaveTextContent('6 pessoas · 2 reservas · 1 evento')
    expect(l[2]).toHaveTextContent('Confirmada')
  })

  it('horário livre do aviso aparece inteiro, depois dos horários "HH:MM"', () => {
    const us = [{ unitId: U1, unidade: 'Asa Sul', totalPessoas: 6, ...lot, avisos: [aviso({ nome: 'Noite', horarioAprox: 'no fim da tarde' }), aviso({ horarioAprox: '20:00' })] }]
    render(<AgendaDia {...base} unidades={us} pedidos={[]} />)
    const l = linhas()
    expect(l[0]).toHaveTextContent('20:00')
    expect(l[1]).toHaveTextContent('no fim da tarde')
    expect(l[1]).toHaveTextContent('Noite')
  })

  it('com várias unidades e sem filtro, cada linha diz a unidade; abas de unidade levam à URL', () => {
    render(<AgendaDia {...base} />)
    expect(linhas()[2]).toHaveTextContent('Asa Sul')
    expect(screen.getByRole('link', { name: 'Lago Sul' })).toHaveAttribute('href', `/agenda?unidade=${U2}`)
    expect(screen.getByRole('link', { name: 'Todas' })).toHaveAttribute('aria-current', 'page')
  })

  it('filtro de unidade: só o que é dela', () => {
    render(<AgendaDia {...base} unidade={U2} pedidos={[pedido(), pedido({ id: crypto.randomUUID(), unitId: U2, unidade: 'Lago Sul', nome: 'Lia' })]} />)
    expect(linhas()).toHaveLength(1)
    expect(linhas()[0]).toHaveTextContent('Lia')
    expect(screen.getByRole('link', { name: 'Lago Sul' })).toHaveAttribute('aria-current', 'page')
  })

  it('uma unidade só: sem abas', () => {
    render(<AgendaDia {...base} unidades={[unidades[0]!]} />)
    expect(screen.queryByRole('navigation', { name: 'Filtrar por unidade' })).not.toBeInTheDocument()
  })

  it('modo demonstração: aviso e pedido simulados levam o selo Simulação; reais não', () => {
    const us = [{ ...unidades[0]!, avisos: [aviso({ nome: 'Real' }), aviso({ nome: 'Sim', simulado: true, horarioAprox: '21:00' })] }]
    render(<AgendaDia {...base} unidades={us} pedidos={[pedido({ simulado: true })]} />)
    const l = linhas()
    expect(l.find((li) => li.textContent?.includes('Caio'))).toHaveTextContent('Simulação')
    expect(l.find((li) => li.textContent?.includes('Sim'))).toHaveTextContent('Simulação')
    expect(l.find((li) => li.textContent?.includes('Real'))).not.toHaveTextContent('Simulação')
  })

  it('o pedido é um link que abre o detalhe pela URL, preservando dia e unidade', () => {
    render(<AgendaDia {...base} dia="2026-10-06" unidade={U1} pedidos={[pedido({ data: '2026-10-06' })]} />)
    expect(screen.getByRole('link', { name: /Caio/ })).toHaveAttribute('href', `/agenda?dia=2026-10-06&unidade=${U1}&pedido=${P1}`)
  })

  it('estado vazio ensina; dia diferente mostra a data', () => {
    const vazio = unidades.map((u) => ({ ...u, avisos: [], totalPessoas: 0 }))
    const { rerender } = render(<AgendaDia {...base} unidades={vazio} pedidos={[]} />)
    expect(screen.getByText('Nada na agenda para hoje')).toBeInTheDocument()
    rerender(<AgendaDia {...base} dia="2026-10-06" unidades={vazio} pedidos={[]} />)
    expect(screen.getByText('Nada na agenda para 06/10/2026')).toBeInTheDocument()
  })

  it('sem unidade cadastrada, pede o cadastro', () => {
    render(<AgendaDia {...base} unidades={[]} pedidos={[]} />)
    expect(screen.getByText('Cadastre uma unidade')).toBeInTheDocument()
  })

  it('seletor de dia: anterior/próximo e o campo de data levam à URL; limites de um ano', () => {
    render(<AgendaDia {...base} unidade={U1} />)
    expect(screen.getByRole('link', { name: 'Dia anterior' })).toHaveAttribute('href', `/agenda?dia=2026-10-04&unidade=${U1}`)
    expect(screen.getByRole('link', { name: 'Próximo dia' })).toHaveAttribute('href', `/agenda?dia=2026-10-06&unidade=${U1}`)
    expect(screen.getByLabelText('Escolher o dia')).toHaveAttribute('min', '2025-10-05')
    expect(screen.getByLabelText('Escolher o dia')).toHaveAttribute('max', '2027-10-05')
    fireEvent.change(screen.getByLabelText('Escolher o dia'), { target: { value: '2026-12-10' } })
    expect(push).toHaveBeenCalledWith(`/agenda?dia=2026-12-10&unidade=${U1}`)
  })

  it('pendentes em outros dias aparecem com link para o dia e o pedido', () => {
    render(<AgendaDia {...base} pedidos={[pedido({ id: crypto.randomUUID(), nome: 'Hoje' }), pedido({ nome: 'Lia', data: '2026-11-20' })]} />)
    const secao = screen.getByRole('region', { name: 'Pedidos para responder em outros dias' })
    expect(within(secao).getByRole('link', { name: /Lia/ })).toHaveAttribute('href', `/agenda?dia=2026-11-20&pedido=${P1}`)
    expect(within(secao).getByRole('link', { name: /Lia/ })).toHaveTextContent('20/11/2026 · Sexta-feira')
    expect(within(secao).queryByText('Hoje')).not.toBeInTheDocument()
  })
})

describe('AgendaDia: todos os pedidos', () => {
  const fila = () => [
    pedido({ id: 'a1', nome: 'Ana', data: '2026-10-20', status: 'novo' }),
    pedido({ id: 'a2', nome: 'Beto', data: '2026-11-02', status: 'confirmado' }),
    pedido({ id: 'a3', nome: 'Cida', data: '2026-09-01', status: 'recusado' }),
    pedido({ id: 'a4', nome: 'Duda', data: '2026-12-01', status: 'em_contato' }),
  ]

  it('alternância Dia | Todos os pedidos com o contador de novos', () => {
    render(<AgendaDia {...base} novos={3} />)
    const secoes = screen.getByRole('navigation', { name: 'Seções da agenda' })
    expect(within(secoes).getByRole('link', { name: 'Dia' })).toHaveAttribute('aria-current', 'page')
    expect(within(secoes).getByRole('link', { name: 'Todos os pedidos (3 novos)' })).toHaveAttribute('href', '/agenda?ver=pedidos')
  })

  it('lista todos os pedidos do filtro (padrão: novo e em contato), de qualquer dia, sem a linha do tempo', () => {
    render(<AgendaDia {...base} ver="pedidos" pedidos={fila()} novos={1} />)
    expect(screen.queryByRole('list', { name: 'Linha do tempo do dia' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Escolher o dia')).not.toBeInTheDocument()
    const lista = screen.getByRole('list', { name: 'Todos os pedidos de evento' })
    const nomes = within(lista).getAllByRole('link').map((l) => l.textContent)
    expect(nomes).toHaveLength(2)
    expect(nomes[0]).toContain('Ana')
    expect(nomes[1]).toContain('Duda')
    // abre o pedido ao lado (lg) ou em folha, sem sair da lista
    expect(within(lista).getByRole('link', { name: /Ana/ })).toHaveAttribute('href', '/agenda?ver=pedidos&pedido=a1')
    expect(within(lista).getByRole('link', { name: /Ana/ })).toHaveTextContent('20/10/2026')
  })

  it('filtro de status: chips ligam e desligam pela URL; confirmados e recusados aparecem quando escolhidos', () => {
    render(<AgendaDia {...base} ver="pedidos" pedidos={fila()} status={['confirmado', 'recusado']} />)
    const filtro = screen.getByRole('navigation', { name: 'Filtrar por status' })
    expect(within(filtro).getByRole('link', { name: 'Confirmado' })).toHaveAttribute('aria-current', 'true')
    expect(within(filtro).getByRole('link', { name: 'Novo' })).not.toHaveAttribute('aria-current')
    expect(within(filtro).getByRole('link', { name: 'Novo' })).toHaveAttribute('href', '/agenda?ver=pedidos&status=novo%2Cconfirmado%2Crecusado')
    expect(within(filtro).getByRole('link', { name: 'Confirmado' })).toHaveAttribute('href', '/agenda?ver=pedidos&status=recusado')
    const lista = screen.getByRole('list', { name: 'Todos os pedidos de evento' })
    // na ordem em que a DAL entrega (a tela não reordena)
    expect(within(lista).getAllByRole('link').map((l) => l.textContent)).toEqual([expect.stringContaining('Beto'), expect.stringContaining('Cida')])
  })

  it('nenhum pedido no filtro: estado vazio', () => {
    render(<AgendaDia {...base} ver="pedidos" pedidos={fila()} status={['cancelado']} />)
    expect(screen.getByText('Nenhum pedido de evento com esse status')).toBeInTheDocument()
  })

  it('no dia, mais de 8 pendentes em outros dias: link para a lista completa em vez de mandar navegar dia a dia', () => {
    const muitos = Array.from({ length: 10 }, (_, i) => pedido({ id: `p${i}`, nome: `P${i}`, data: `2026-11-${String(i + 10)}` }))
    render(<AgendaDia {...base} pedidos={muitos} />)
    const secao = screen.getByRole('region', { name: 'Pedidos para responder em outros dias' })
    expect(within(secao).getAllByRole('listitem')).toHaveLength(8)
    expect(within(secao).getByRole('link', { name: 'Ver todos os pedidos (10)' })).toHaveAttribute('href', '/agenda?ver=pedidos')
  })

  it('no dia, sem "mostrar cancelados", o pedido recusado do dia fica fora da linha do tempo', () => {
    render(<AgendaDia {...base} pedidos={[pedido(), pedido({ id: 'r1', nome: 'Recusado', status: 'recusado' })]} />)
    expect(screen.queryByText('Recusado', { selector: 'span' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Caio/ })).toBeInTheDocument()
  })

  it('no desktop, o pedido aberto da lista fica ao lado dela', async () => {
    comoDesktop()
    render(<AgendaDia {...base} ver="pedidos" pedidos={fila()} pedidoId="a2" status={['confirmado']} />)
    const lado = await screen.findByRole('complementary', { name: 'Pedido de evento' })
    expect(within(lado).getByRole('link', { name: 'Fechar o pedido' })).toHaveAttribute('href', '/agenda?ver=pedidos&status=confirmado')
  })
})

describe('AgendaDia: reservas', () => {
  it('lotação do dia por unidade no topo: "147/150" ou "sem limite"', () => {
    render(<AgendaDia {...base} />)
    const lotacao = screen.getByRole('list', { name: 'Lotação do dia' })
    const itens = within(lotacao).getAllByRole('listitem')
    expect(itens[0]).toHaveTextContent('Asa Sul')
    expect(itens[0]).toHaveTextContent('147/150')
    expect(itens[1]).toHaveTextContent('Lago Sul')
    expect(itens[1]).toHaveTextContent('sem limite')
  })

  it('lotação: só a unidade do filtro; unidade cheia ganha a etiqueta Lotada; simulação aparece à parte', () => {
    const us = [{ ...unidades[0]!, ocupadas: 150, ocupadasSimulacao: 6 }, unidades[1]!]
    render(<AgendaDia {...base} unidades={us} unidade={U1} />)
    const itens = within(screen.getByRole('list', { name: 'Lotação do dia' })).getAllByRole('listitem')
    expect(itens).toHaveLength(1)
    expect(itens[0]).toHaveTextContent('150/150')
    expect(within(itens[0]!).getByText('Lotada')).toHaveAttribute('data-slot', 'etiqueta-status')
    expect(itens[0]).toHaveTextContent('Simulação: 6/150')
  })

  it('linha da reserva: horário, nome, pessoas e a etiqueta da situação; abre o detalhe pela URL', () => {
    const us = [{ ...unidades[0]!, avisos: [
      aviso({ id: R1, nome: 'Bia', horario: '19:00:00', horarioAprox: null }),
      aviso({ nome: 'Caio', status: 'cancelada' }),
      aviso({ nome: 'Duda', status: 'nao_veio', horarioAprox: '21:00' }),
    ] }]
    render(<AgendaDia {...base} cancelados unidades={us} pedidos={[]} />)
    const l = linhas()
    expect(l[0]).toHaveTextContent('19:00')
    expect(l[0]).toHaveTextContent('Bia')
    expect(l[0]).toHaveTextContent('Reserva · 4 pessoas')
    expect(within(l[0]!).getByText('Confirmada')).toHaveAttribute('data-slot', 'etiqueta-status')
    expect(within(l[1]!).getByText('Cancelada')).toHaveAttribute('data-slot', 'etiqueta-status')
    expect(within(l[2]!).getByText('Não veio')).toHaveAttribute('data-slot', 'etiqueta-status')
    expect(within(l[0]!).getByRole('link')).toHaveAttribute('href', `/agenda?cancelados=1&reserva=${R1}`)
  })

  it('atendente não vê Nova reserva', () => {
    render(<AgendaDia {...base} podeEditar={false} />)
    expect(screen.queryByRole('button', { name: 'Nova reserva' })).not.toBeInTheDocument()
  })

  it('dia passado ou além de 30 dias: sem Nova reserva', () => {
    const { rerender } = render(<AgendaDia {...base} dia="2026-10-04" />)
    expect(screen.getByText('Dia passado: só consulta (e marcar quem não veio).')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nova reserva' })).not.toBeInTheDocument()
    rerender(<AgendaDia {...base} dia="2026-11-20" />)
    expect(screen.queryByRole('button', { name: 'Nova reserva' })).not.toBeInTheDocument()
  })

  it('Nova reserva abre o formulário com o dia escolhido', async () => {
    const user = userEvent.setup()
    render(<AgendaDia {...base} dia="2026-10-06" unidade={U1} />)
    await user.click(screen.getByRole('button', { name: 'Nova reserva' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Nova reserva' })
    expect(within(dialogo).getByRole('button', { name: 'Salvar reserva' })).toBeInTheDocument()
    expect(within(dialogo).getByLabelText(/^Dia/)).toHaveValue('2026-10-06')
  })

  it('cancelados ficam ocultos até pedir; link para mostrar e ocultar', () => {
    render(<AgendaDia {...base} cancelados unidades={[{ ...unidades[0]!, avisos: [aviso(), aviso({ status: 'cancelada', nome: 'Bia' })] }]} />)
    expect(screen.getByRole('link', { name: 'Ocultar cancelados' })).toHaveAttribute('href', '/agenda')
  })

  it('no celular a reserva abre em folha; fechar tira a reserva da URL', async () => {
    render(<AgendaDia {...base} unidade={U1} reservaId={R1} />)
    const dialogo = await screen.findByRole('dialog', { name: 'Reserva' })
    expect(dialogo).toHaveTextContent('Ana')
    expect(within(dialogo).getByRole('group', { name: 'Mudar a situação' })).toBeInTheDocument()
    await userEvent.setup().keyboard('{Escape}')
    expect(push).toHaveBeenCalledWith(`/agenda?unidade=${U1}`, { scroll: false })
  })

  it('no desktop a reserva abre ao lado, marca a linha (cartão + barra, nunca accent); cancelar com cancelados ocultos fecha', async () => {
    comoDesktop()
    const user = userEvent.setup()
    mudarStatusReservaAction.mockResolvedValue({ ok: true, data: null })
    render(<AgendaDia {...base} reservaId={R1} />)
    const lado = await screen.findByRole('complementary', { name: 'Reserva' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const linha = within(screen.getByRole('list', { name: 'Linha do tempo do dia' })).getByRole('link', { name: /Ana/ })
    expect(linha).toHaveAttribute('aria-current', 'true')
    expect(linha.className).toContain('bg-card')
    expect(linha.className).not.toMatch(/(^|\s)bg-accent/)
    expect(within(lado).getByRole('link', { name: 'Fechar a reserva' })).toHaveAttribute('href', '/agenda')
    await user.click(within(lado).getByRole('button', { name: 'Cancelada' }))
    await waitFor(() => expect(mudarStatusReservaAction).toHaveBeenCalledWith(R1, 'cancelada'))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/agenda', { scroll: false }))
  })

  it('com "mostrar cancelados", mudar a situação mantém a reserva aberta e recarrega', async () => {
    comoDesktop()
    const user = userEvent.setup()
    mudarStatusReservaAction.mockResolvedValue({ ok: true, data: null })
    render(<AgendaDia {...base} cancelados reservaId={R1} />)
    const lado = await screen.findByRole('complementary', { name: 'Reserva' })
    await user.click(within(lado).getByRole('button', { name: 'Não veio' }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(push).not.toHaveBeenCalled()
  })

  it('reserva da URL que não está no dia não abre nada', async () => {
    render(<AgendaDia {...base} reservaId="00000000-0000-4000-8000-0000000000ff" />)
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('AgendaDia: detalhe do pedido', () => {
  it('no celular abre em folha; fechar tira o pedido da URL e o telefone some', async () => {
    const user = userEvent.setup()
    revelarTelefoneAction.mockResolvedValue({ ok: true, data: { telefone: '+5561999990000' } })
    const { rerender } = render(<AgendaDia {...base} unidade={U1} pedidoId={P1} />)
    const dialogo = await screen.findByRole('dialog', { name: 'Pedido de evento' })
    expect(dialogo).toHaveTextContent('Sem glúten')
    await user.click(within(dialogo).getByRole('button', { name: 'Mostrar telefone' }))
    expect(await within(dialogo).findByText('+5561999990000')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(push).toHaveBeenCalledWith(`/agenda?unidade=${U1}`, { scroll: false })
    rerender(<AgendaDia {...base} unidade={U1} pedidoId={null} />)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(document.body).not.toHaveTextContent('5561999990000')
  })

  it('no celular, salvar fecha a folha e recarrega os dados', async () => {
    const user = userEvent.setup()
    render(<AgendaDia {...base} pedidoId={P1} />)
    const dialogo = await screen.findByRole('dialog', { name: 'Pedido de evento' })
    await user.selectOptions(within(dialogo).getByLabelText('Status'), 'em_contato')
    await user.click(within(dialogo).getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(atualizarPedidoAction).toHaveBeenCalledWith(P1, { status: 'em_contato', responsavelId: '', notasInternas: '' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/agenda', { scroll: false }))
  })

  it('no desktop abre ao lado (sem diálogo), marca a linha e salvar mantém aberto', async () => {
    comoDesktop()
    const user = userEvent.setup()
    render(<AgendaDia {...base} pedidoId={P1} />)
    const lado = await screen.findByRole('complementary', { name: 'Pedido de evento' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // fixo ao rolar, abaixo da barra superior (sticky top-0, ~57 px), e não por baixo dela
    expect(lado.className).toContain('top-[4.5rem]')
    const linha = screen.getByRole('link', { name: /Caio/ })
    expect(linha).toHaveAttribute('aria-current', 'true')
    // etiqueta de sucesso ("Confirmado") fica AA: linha aberta em fundo de cartão + barra laranja, nunca accent/muted
    expect(linha.className).toContain('bg-card')
    expect(linha.className).toContain('shadow-[inset_3px_0_0_var(--primary)]')
    expect(linha.className).not.toMatch(/(^|\s)bg-accent/)
    expect(within(lado).getByRole('link', { name: 'Fechar o pedido' })).toHaveAttribute('href', '/agenda')
    await user.click(within(lado).getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(push).not.toHaveBeenCalled()
  })

  it('pedido da URL que não está na lista não abre nada', async () => {
    render(<AgendaDia {...base} pedidoId="00000000-0000-4000-8000-0000000000ff" />)
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })
})
