import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const push = vi.fn()
const replace = vi.fn()
const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace, refresh }), usePathname: () => '/agenda' }))
const criarAvisoAction = vi.fn()
const cancelarAvisoAction = vi.fn()
vi.mock('@/app/(painel)/agenda/actions', () => ({ criarAvisoAction, cancelarAvisoAction }))
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
  id: crypto.randomUUID(), unitId: U1, nome: 'Ana', pessoas: 4, horarioAprox: '20:00' as string | null,
  origem: 'ia' as const, status: 'ativo' as 'ativo' | 'cancelado', simulado: false, ...over,
})
const pedido = (over = {}) => ({
  id: P1, unitId: U1, unidade: 'Asa Sul', spaceId: null, espaco: 'Salão Jardim' as string | null, nome: 'Caio' as string | null, data: '2026-10-05',
  convidados: 30, tipo: 'aniversario' as const, tipoTexto: null, observacoes: 'Sem glúten', status: 'novo' as 'novo' | 'em_contato' | 'confirmado' | 'recusado' | 'cancelado',
  responsavelId: null, responsavel: null, notasInternas: null, temTelefone: true, simulado: false, criadoEm: new Date('2026-10-05T12:00:00Z'), ...over,
})
const unidades = [
  { unitId: U1, unidade: 'Asa Sul', totalPessoas: 6, avisos: [aviso({ horarioAprox: '20:00' }), aviso({ nome: null, pessoas: 2, horarioAprox: '12:30', origem: 'painel' })] },
  { unitId: U2, unidade: 'Lago Sul', totalPessoas: 0, avisos: [] },
]
const base = {
  dia: '2026-10-05', hoje: '2026-10-05', unidades, pedidos: [pedido()], unidade: null as string | null, cancelados: false,
  pedidoId: null as string | null, membros: [{ id: M1, nome: 'Bia', todas: true, unidades: [] }], podeEditar: true,
  agora: new Date('2026-10-05T15:00:00Z'),
}
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
    expect(screen.getByTestId('resumo-do-dia')).toHaveTextContent('6 pessoas · 2 avisos · 1 evento')
  })

  it('horário livre do aviso aparece inteiro, depois dos horários "HH:MM"', () => {
    const us = [{ unitId: U1, unidade: 'Asa Sul', totalPessoas: 6, avisos: [aviso({ nome: 'Noite', horarioAprox: 'no fim da tarde' }), aviso({ horarioAprox: '20:00' })] }]
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

describe('AgendaDia: avisos', () => {
  it('atendente não vê Novo aviso nem Cancelar', () => {
    render(<AgendaDia {...base} podeEditar={false} />)
    expect(screen.queryByRole('button', { name: 'Novo aviso' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Cancelar aviso/ })).not.toBeInTheDocument()
  })

  it('dia passado ou além de 30 dias: sem Novo aviso nem Cancelar', () => {
    const { rerender } = render(<AgendaDia {...base} dia="2026-10-04" />)
    expect(screen.getByText('Dia passado: só consulta.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Novo aviso' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Cancelar aviso/ })).not.toBeInTheDocument()
    rerender(<AgendaDia {...base} dia="2026-11-20" />)
    expect(screen.queryByRole('button', { name: 'Novo aviso' })).not.toBeInTheDocument()
  })

  it('Novo aviso abre o formulário com o dia escolhido', async () => {
    const user = userEvent.setup()
    render(<AgendaDia {...base} dia="2026-10-06" unidade={U1} />)
    await user.click(screen.getByRole('button', { name: 'Novo aviso' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Novo aviso' })
    expect(within(dialogo).getByRole('button', { name: 'Anotar aviso' })).toBeInTheDocument()
  })

  it('cancelar pede confirmação e só então chama a action', async () => {
    const user = userEvent.setup()
    cancelarAvisoAction.mockResolvedValue({ ok: true, data: null })
    render(<AgendaDia {...base} />)
    await user.click(screen.getByRole('button', { name: 'Cancelar aviso de Ana, 4 pessoas' }))
    expect(cancelarAvisoAction).not.toHaveBeenCalled()
    const dialogo = await screen.findByRole('dialog')
    await user.click(within(dialogo).getByRole('button', { name: 'Cancelar aviso' }))
    await waitFor(() => expect(cancelarAvisoAction).toHaveBeenCalledWith(unidades[0]!.avisos[0]!.id))
    expect(cancelarAvisoAction).toHaveBeenCalledTimes(1)
  })

  it('cancelados: sem botão, com selo, e link para ocultar', () => {
    const cancelado = aviso({ status: 'cancelado', nome: 'Bia' })
    render(<AgendaDia {...base} cancelados unidades={[{ ...unidades[0]!, avisos: [aviso(), cancelado] }]} />)
    expect(screen.getAllByText('Cancelado').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /Cancelar aviso de Bia/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ocultar cancelados' })).toHaveAttribute('href', '/agenda')
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
