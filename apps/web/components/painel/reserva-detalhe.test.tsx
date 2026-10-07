import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mudarStatusReservaAction = vi.fn()
const revelarContatoReservaAction = vi.fn()
vi.mock('@/app/(painel)/agenda/actions', () => ({ mudarStatusReservaAction, revelarContatoReservaAction }))
const toastSucesso = vi.fn()
const toastErro = vi.fn()
vi.mock('sonner', () => ({ toast: { success: toastSucesso, error: toastErro } }))

const { ReservaDetalhe } = await import('./reserva-detalhe')

const R1 = '00000000-0000-4000-8000-0000000000c1'
const U1 = '00000000-0000-4000-8000-000000000001'
const reserva = (over = {}) => ({
  id: R1, unitId: U1, nome: 'Ana' as string | null, pessoas: 4, horarioAprox: null as string | null, horario: '20:00:00' as string | null,
  origem: 'ia' as 'ia' | 'painel', status: 'confirmada' as 'confirmada' | 'cancelada' | 'nao_veio', simulado: false, temContato: true, ...over,
})
const base = { unidade: 'Asa Sul', dia: '2026-10-05', hoje: '2026-10-05', podeEditar: true, onMudou: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  mudarStatusReservaAction.mockResolvedValue({ ok: true, data: null })
})

describe('ReservaDetalhe', () => {
  it('mostra os dados da reserva, com a situação em etiqueta', () => {
    const { container } = render(<ReservaDetalhe {...base} reserva={reserva()} />)
    const dados = container.querySelector('dl')!
    expect(dados).toHaveTextContent('Ana')
    expect(dados).toHaveTextContent('Asa Sul')
    expect(dados).toHaveTextContent('20:00')
    expect(dados).toHaveTextContent('4 pessoas')
    expect(within(dados).getByText('Confirmada')).toHaveAttribute('data-slot', 'etiqueta-status')
  })

  it('ver contato: chama a action auditada só no clique; mostra o número, de onde veio, e links; ocultar some com ele', async () => {
    const user = userEvent.setup()
    revelarContatoReservaAction.mockResolvedValue({ ok: true, data: { telefone: '+5561999998888', origem: 'informado' } })
    render(<ReservaDetalhe {...base} reserva={reserva()} />)
    expect(revelarContatoReservaAction).not.toHaveBeenCalled()
    expect(screen.getByText('Cada consulta ao contato fica registrada.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Ver contato' }))
    expect(revelarContatoReservaAction).toHaveBeenCalledWith(R1)
    expect(await screen.findByText('+55 (61) 99999-8888')).toBeInTheDocument()
    expect(screen.getByText('Número informado pelo cliente')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ligar' })).toHaveAttribute('href', 'tel:+5561999998888')
    expect(screen.getByRole('link', { name: 'Abrir no WhatsApp' })).toHaveAttribute('href', 'https://wa.me/5561999998888')
    await user.click(screen.getByRole('button', { name: 'Ocultar contato' }))
    expect(screen.queryByText('+55 (61) 99999-8888')).not.toBeInTheDocument()
  })

  it('contato do WhatsApp diz de onde veio; sem contato, sem botão; falha vira aviso', async () => {
    const user = userEvent.setup()
    revelarContatoReservaAction.mockResolvedValue({ ok: true, data: { telefone: '5561988887777', origem: 'whatsapp' } })
    const { unmount } = render(<ReservaDetalhe {...base} reserva={reserva()} />)
    await user.click(screen.getByRole('button', { name: 'Ver contato' }))
    expect(await screen.findByText('WhatsApp de onde o cliente reservou')).toBeInTheDocument()
    // o WhatsApp vem cru do banco ("5561…"): aparece com máscara
    expect(screen.getByText('+55 (61) 98888-7777')).toBeInTheDocument()
    unmount()
    render(<ReservaDetalhe {...base} reserva={reserva({ id: crypto.randomUUID(), temContato: false })} />)
    expect(screen.queryByRole('button', { name: 'Ver contato' })).not.toBeInTheDocument()
    expect(screen.getByText('Sem telefone de contato.')).toBeInTheDocument()
  })

  it('falha ao ver o contato vira aviso', async () => {
    const user = userEvent.setup()
    revelarContatoReservaAction.mockResolvedValue({ ok: false, formError: 'Essa reserva não está mais disponível.' })
    render(<ReservaDetalhe {...base} reserva={reserva()} />)
    await user.click(screen.getByRole('button', { name: 'Ver contato' }))
    await waitFor(() => expect(toastErro).toHaveBeenCalledWith('Essa reserva não está mais disponível.'))
  })

  it('ações Confirmada, Cancelada e Não veio: a atual fica marcada; só as válidas para o dia ficam ativas', async () => {
    const user = userEvent.setup()
    const onMudou = vi.fn()
    render(<ReservaDetalhe {...base} onMudou={onMudou} reserva={reserva()} />)
    const grupo = screen.getByRole('group', { name: 'Mudar a situação' })
    expect(within(grupo).getByRole('button', { name: 'Confirmada' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(grupo).getByRole('button', { name: 'Confirmada' })).toBeDisabled()
    await user.click(within(grupo).getByRole('button', { name: 'Não veio' }))
    await waitFor(() => expect(mudarStatusReservaAction).toHaveBeenCalledWith(R1, 'nao_veio'))
    expect(toastSucesso).toHaveBeenCalledWith('Reserva marcada como “Não veio”.')
    expect(onMudou).toHaveBeenCalledWith('nao_veio')
  })

  it('reserva de outro dia: não veio fica desativado até o dia', () => {
    render(<ReservaDetalhe {...base} dia="2026-10-08" reserva={reserva()} />)
    expect(screen.getByRole('button', { name: 'Não veio' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancelada' })).toBeEnabled()
    expect(screen.getByText('“Não veio” fica disponível no dia da reserva.')).toBeInTheDocument()
  })

  it('reconfirmar sem vaga: a mensagem aparece no detalhe e nada muda', async () => {
    const user = userEvent.setup()
    const onMudou = vi.fn()
    mudarStatusReservaAction.mockResolvedValue({ ok: false, formError: 'A unidade está lotada nesse dia. Restam 2 vagas.' })
    render(<ReservaDetalhe {...base} dia="2026-10-06" onMudou={onMudou} reserva={reserva({ status: 'cancelada' })} />)
    await user.click(screen.getByRole('button', { name: 'Confirmada' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('A unidade está lotada nesse dia. Restam 2 vagas.')
    expect(onMudou).not.toHaveBeenCalled()
  })

  it('atendente: vê e pode ver o contato, mas não muda a situação', () => {
    render(<ReservaDetalhe {...base} podeEditar={false} reserva={reserva()} />)
    expect(screen.queryByRole('group', { name: 'Mudar a situação' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ver contato' })).toBeInTheDocument()
  })
})
