import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const atualizarPedidoAction = vi.fn()
const revelarTelefoneAction = vi.fn()
vi.mock('@/app/(painel)/agenda/eventos-actions', () => ({ atualizarPedidoAction, revelarTelefoneAction }))
const toastErro = vi.fn()
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: toastErro } }))

const { PedidoDetalhe } = await import('./pedido-detalhe')

const U1 = '00000000-0000-4000-8000-000000000001'
const M1 = '00000000-0000-4000-8000-0000000000b1'
const pedido = (over = {}) => ({
  id: '00000000-0000-4000-8000-0000000000aa', unitId: U1, unidade: 'Asa Sul', spaceId: null, espaco: 'Salão Jardim', nome: 'Ana',
  data: '2026-10-10', convidados: 30, tipo: 'aniversario' as const, tipoTexto: null, observacoes: 'Sem glúten', status: 'novo' as const,
  responsavelId: null, responsavel: null, notasInternas: null, temTelefone: true, simulado: false, criadoEm: new Date('2026-10-05T12:00:00Z'), ...over,
})
const membrosBase = [{ id: M1, nome: 'Bia', todas: true, unidades: [] }]
const onSalvo = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  atualizarPedidoAction.mockResolvedValue({ ok: true, data: null })
})

describe('PedidoDetalhe', () => {
  const abrir = async (p = pedido()) => {
    const user = userEvent.setup()
    const { container } = render(<PedidoDetalhe pedido={p} membros={membrosBase} onSalvo={onSalvo} />)
    return { user, dialogo: container }
  }

  it('o seletor de responsável lista só quem acessa a unidade do pedido', async () => {
    const membros = [
      { id: M1, nome: 'Bia', todas: false, unidades: [U1] },
      { id: 'm2', nome: 'Caio', todas: false, unidades: ['00000000-0000-4000-8000-000000000002'] },
      { id: 'm3', nome: 'Dani', todas: true, unidades: [] },
    ]
    const { container: dialogo } = render(<PedidoDetalhe pedido={pedido()} membros={membros} onSalvo={onSalvo} />)
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
    expect(atualizarPedidoAction).toHaveBeenCalledWith(pedido().id, { status: 'em_contato', responsavelId: M1, notasInternas: 'ligar amanhã' })
    liberar()
    await waitFor(() => expect(onSalvo).toHaveBeenCalled())
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
    expect(onSalvo).not.toHaveBeenCalled()
  })

  it('Mostrar telefone chama a action, exibe com links tel e wa.me, e some ao fechar', async () => {
    revelarTelefoneAction.mockResolvedValue({ ok: true, data: { telefone: '+5561999990000' } })
    const { user, dialogo } = await abrir()
    expect(dialogo).not.toHaveTextContent('5561999990000')
    await user.click(within(dialogo).getByRole('button', { name: 'Mostrar telefone' }))
    expect(await within(dialogo).findByText('+5561999990000')).toBeInTheDocument()
    expect(revelarTelefoneAction).toHaveBeenCalledWith(pedido().id)
    expect(within(dialogo).getByRole('link', { name: 'Ligar' })).toHaveAttribute('href', 'tel:+5561999990000')
    expect(within(dialogo).getByRole('link', { name: 'Abrir no WhatsApp' })).toHaveAttribute('href', 'https://wa.me/5561999990000')
    // fechar o pedido (folha ou painel ao lado) é coberto em agenda-dia.test.tsx
    await user.click(within(dialogo).getByRole('button', { name: 'Ocultar telefone' }))
    expect(document.body).not.toHaveTextContent('5561999990000')
    expect(await screen.findByRole('button', { name: 'Mostrar telefone' })).toBeInTheDocument()
  })

  it('falha ao mostrar o telefone vira aviso, sem número na tela', async () => {
    revelarTelefoneAction.mockResolvedValue({ ok: false, formError: 'Esse pedido não está mais disponível.' })
    const { user, dialogo } = await abrir()
    await user.click(within(dialogo).getByRole('button', { name: 'Mostrar telefone' }))
    await waitFor(() => expect(toastErro).toHaveBeenCalledWith('Esse pedido não está mais disponível.'))
    expect(within(dialogo).getByRole('button', { name: 'Mostrar telefone' })).toBeEnabled()
  })

  it('pedido simulado (modo demonstração) leva o selo Simulação e não tem botão de telefone', async () => {
    const { dialogo } = await abrir(pedido({ simulado: true }))
    expect(dialogo).toHaveTextContent('Simulação')
    expect(within(dialogo).queryByRole('button', { name: /telefone/i })).toBeNull()
  })

  it('sem telefone (cliente removido): não há botão', async () => {
    const { dialogo } = await abrir(pedido({ temTelefone: false }))
    expect(within(dialogo).queryByRole('button', { name: 'Mostrar telefone' })).not.toBeInTheDocument()
  })
})
