import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh }), usePathname: () => '/agenda' }))
const atualizarPedidoAction = vi.fn()
const revelarTelefoneAction = vi.fn()
vi.mock('@/app/(painel)/agenda/eventos-actions', () => ({ atualizarPedidoAction, revelarTelefoneAction }))
const toastErro = vi.fn()
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: toastErro } }))

const { Eventos } = await import('./eventos')

const U1 = '00000000-0000-4000-8000-000000000001'
const M1 = '00000000-0000-4000-8000-0000000000b1'
const agora = new Date('2026-10-05T15:00:00Z')
const pedido = (over = {}) => ({
  id: '00000000-0000-4000-8000-0000000000aa', unitId: U1, unidade: 'Asa Sul', spaceId: null, espaco: 'Salão Jardim', nome: 'Ana',
  data: '2026-10-10', convidados: 30, tipo: 'aniversario' as const, tipoTexto: null, observacoes: 'Sem glúten', status: 'novo' as const,
  responsavelId: null, responsavel: null, notasInternas: null, temTelefone: true, simulado: false, criadoEm: new Date('2026-10-05T12:00:00Z'), ...over,
})
const base = {
  pedidos: [pedido(), pedido({ id: '00000000-0000-4000-8000-0000000000ab', nome: null, status: 'em_contato', espaco: null, convidados: 1 })],
  unidades: [{ id: U1, nome: 'Asa Sul' }, { id: '00000000-0000-4000-8000-000000000002', nome: 'Lago Sul' }],
  status: ['novo' as const, 'em_contato' as const], unidade: null, membros: [{ id: M1, nome: 'Bia', todas: true, unidades: [] }], agora,
}

beforeEach(() => {
  vi.clearAllMocks()
  atualizarPedidoAction.mockResolvedValue({ ok: true, data: null })
})

describe('Eventos: fila', () => {
  it('pedido simulado leva o selo Simulação na fila e no detalhe, sem o botão de telefone', async () => {
    const user = userEvent.setup()
    render(<Eventos {...base} pedidos={[pedido({ simulado: true })]} />)
    const item = screen.getByRole('button', { name: /Ana/ })
    expect(item).toHaveTextContent('Simulação')
    await user.click(item)
    const dialogo = await screen.findByRole('dialog')
    expect(dialogo).toHaveTextContent('Simulação')
    expect(within(dialogo).queryByRole('button', { name: /telefone/i })).toBeNull()
  })

  it('pedido real não leva o selo Simulação', () => {
    render(<Eventos {...base} />)
    expect(screen.queryByText('Simulação')).toBeNull()
  })

  it('mostra selo, data com dia da semana, convidados, tipo, unidade/espaço, nome e "há X horas"', () => {
    render(<Eventos {...base} />)
    const item = screen.getByRole('button', { name: /Ana/ })
    expect(item).toHaveTextContent('Novo')
    expect(item).toHaveTextContent('10/10/2026 · Sábado')
    expect(item).toHaveTextContent('30 convidados · aniversário')
    expect(item).toHaveTextContent('Asa Sul · Salão Jardim · há 3 horas')
    expect(screen.getByRole('button', { name: /Sem nome/ })).toHaveTextContent('1 convidado')
  })

  it('chips de status marcam o filtro e alternam pela URL; unidades só as permitidas', () => {
    render(<Eventos {...base} />)
    expect(screen.getByRole('link', { name: 'Novo' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('link', { name: 'Confirmado' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: 'Confirmado' })).toHaveAttribute('href', '/agenda?aba=eventos&status=novo,em_contato,confirmado')
    expect(screen.getByRole('link', { name: 'Novo' })).toHaveAttribute('href', '/agenda?aba=eventos&status=em_contato')
    expect(screen.getByRole('link', { name: 'Lago Sul' })).toHaveAttribute('href', `/agenda?aba=eventos&unidade=00000000-0000-4000-8000-000000000002`)
    expect(screen.getByRole('link', { name: 'Todas' })).toHaveAttribute('aria-current', 'page')
  })

  it('estado vazio ensina', () => {
    render(<Eventos {...base} pedidos={[]} />)
    expect(screen.getByText('Nenhum pedido de evento por aqui')).toBeInTheDocument()
    expect(screen.getByText('Quando um cliente pedir pelo WhatsApp, ele aparece nesta lista.')).toBeInTheDocument()
  })
})

describe('Eventos: detalhe', () => {
  const abrir = async (p = pedido()) => {
    const user = userEvent.setup()
    render(<Eventos {...base} pedidos={[p]} />)
    await user.click(screen.getByRole('button', { name: /Ana/ }))
    return { user, dialogo: await screen.findByRole('dialog') }
  }

  it('o seletor de responsável lista só quem acessa a unidade do pedido', async () => {
    const user = userEvent.setup()
    const membros = [
      { id: M1, nome: 'Bia', todas: false, unidades: [U1] },
      { id: 'm2', nome: 'Caio', todas: false, unidades: ['00000000-0000-4000-8000-000000000002'] },
      { id: 'm3', nome: 'Dani', todas: true, unidades: [] },
    ]
    render(<Eventos {...base} membros={membros} pedidos={[pedido()]} />)
    await user.click(screen.getByRole('button', { name: /Ana/ }))
    const dialogo = await screen.findByRole('dialog')
    const opcoes = within(within(dialogo).getByLabelText('Responsável')).getAllByRole('option').map((o) => o.textContent)
    expect(opcoes).toEqual(['Ninguém', 'Bia', 'Dani'])
  })

  it('mostra os dados, as observações e só as transições válidas', async () => {
    const { dialogo } = await abrir(pedido({ status: 'confirmado' }))
    expect(dialogo).toHaveTextContent('Sem glúten')
    expect(dialogo).toHaveTextContent('Salão Jardim')
    const opcoes = within(within(dialogo).getByLabelText('Status')).getAllByRole('option').map((o) => o.textContent)
    expect(opcoes).toEqual(['Confirmado', 'Cancelado'])
    const resp = within(within(dialogo).getByLabelText('Responsável')).getAllByRole('option').map((o) => o.textContent)
    expect(resp).toEqual(['Ninguém', 'Bia'])
  })

  it('salva status, responsável e notas uma vez só, mesmo com duplo clique', async () => {
    let liberar!: () => void
    atualizarPedidoAction.mockImplementation(() => new Promise((r) => { liberar = () => r({ ok: true, data: null }) }))
    const { user, dialogo } = await abrir()
    await user.selectOptions(within(dialogo).getByLabelText('Status'), 'em_contato')
    await user.selectOptions(within(dialogo).getByLabelText('Responsável'), M1)
    await user.type(within(dialogo).getByLabelText('Notas internas'), 'ligar amanhã')
    const salvar = within(dialogo).getByRole('button', { name: 'Salvar' })
    await user.dblClick(salvar)
    await waitFor(() => expect(atualizarPedidoAction).toHaveBeenCalledTimes(1))
    expect(atualizarPedidoAction).toHaveBeenCalledWith(base.pedidos[0]!.id, { status: 'em_contato', responsavelId: M1, notasInternas: 'ligar amanhã' })
    liberar()
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(atualizarPedidoAction).toHaveBeenCalledTimes(1)
  })

  it('notas acima de 2000 não chegam à action', async () => {
    const { user, dialogo } = await abrir()
    const notas = within(dialogo).getByLabelText('Notas internas')
    await user.click(notas)
    await user.paste('x'.repeat(2001))
    await user.click(within(dialogo).getByRole('button', { name: 'Salvar' }))
    expect(await within(dialogo).findByText('Use no máximo 2000 caracteres')).toBeInTheDocument()
    expect(atualizarPedidoAction).not.toHaveBeenCalled()
  })

  it('transição inválida do servidor aparece no campo Status', async () => {
    atualizarPedidoAction.mockResolvedValue({ ok: false, fieldErrors: { status: 'Esse status não pode mais ser alterado assim.' } })
    const { user, dialogo } = await abrir()
    await user.click(within(dialogo).getByRole('button', { name: 'Salvar' }))
    expect(await within(dialogo).findByText('Esse status não pode mais ser alterado assim.')).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('Mostrar telefone chama a action, exibe com links tel e wa.me, e some ao fechar', async () => {
    revelarTelefoneAction.mockResolvedValue({ ok: true, data: { telefone: '+5561999990000' } })
    const { user, dialogo } = await abrir()
    expect(dialogo).not.toHaveTextContent('5561999990000')
    await user.click(within(dialogo).getByRole('button', { name: 'Mostrar telefone' }))
    expect(await within(dialogo).findByText('+5561999990000')).toBeInTheDocument()
    expect(revelarTelefoneAction).toHaveBeenCalledWith(base.pedidos[0]!.id)
    expect(within(dialogo).getByRole('link', { name: 'Ligar' })).toHaveAttribute('href', 'tel:+5561999990000')
    expect(within(dialogo).getByRole('link', { name: 'Abrir no WhatsApp' })).toHaveAttribute('href', 'https://wa.me/5561999990000')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(document.body).not.toHaveTextContent('5561999990000')
    await user.click(screen.getByRole('button', { name: /Ana/ }))
    expect(await screen.findByRole('button', { name: 'Mostrar telefone' })).toBeInTheDocument()
  })

  it('falha ao mostrar o telefone vira aviso, sem número na tela', async () => {
    revelarTelefoneAction.mockResolvedValue({ ok: false, formError: 'Esse pedido não está mais disponível.' })
    const { user, dialogo } = await abrir()
    await user.click(within(dialogo).getByRole('button', { name: 'Mostrar telefone' }))
    await waitFor(() => expect(toastErro).toHaveBeenCalledWith('Esse pedido não está mais disponível.'))
    expect(within(dialogo).getByRole('button', { name: 'Mostrar telefone' })).toBeEnabled()
  })

  it('sem telefone (cliente removido): não há botão', async () => {
    const { dialogo } = await abrir(pedido({ temTelefone: false }))
    expect(within(dialogo).queryByRole('button', { name: 'Mostrar telefone' })).not.toBeInTheDocument()
  })
})
