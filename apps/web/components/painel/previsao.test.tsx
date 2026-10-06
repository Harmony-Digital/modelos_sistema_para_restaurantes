import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const push = vi.fn()
const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }), usePathname: () => '/previsao' }))
const criarAvisoAction = vi.fn()
const cancelarAvisoAction = vi.fn()
vi.mock('@/app/(painel)/previsao/actions', () => ({ criarAvisoAction, cancelarAvisoAction }))

const { Previsao } = await import('./previsao')
const { AvisoForm } = await import('./aviso-form')

const U1 = '00000000-0000-4000-8000-000000000001'
const U2 = '00000000-0000-4000-8000-000000000002'
const aviso = (over = {}) => ({ id: crypto.randomUUID(), unitId: U1, nome: 'Ana', pessoas: 4, horarioAprox: '20:00', origem: 'ia' as const, status: 'ativo' as const, ...over })
const unidades = [
  { unitId: U1, unidade: 'Asa Sul', totalPessoas: 6, avisos: [aviso(), aviso({ nome: null, pessoas: 2, horarioAprox: null, origem: 'painel' })] },
  { unitId: U2, unidade: 'Lago Sul', totalPessoas: 0, avisos: [] },
]
const base = { data: '2026-10-05', hoje: '2026-10-05', unidades, filtro: null, mostrarCancelados: false, podeEditar: true }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Previsao', () => {
  it('mostra totais, lista com origem, nome ou "Sem nome" e abas de unidade', () => {
    render(<Previsao {...base} />)
    expect(screen.getByText('6 pessoas')).toBeInTheDocument()
    expect(screen.getByText(/2 avisos/)).toBeInTheDocument()
    expect(screen.getByText('Ana')).toBeInTheDocument()
    expect(screen.getByText('Sem nome')).toBeInTheDocument()
    expect(screen.getByText('IA')).toBeInTheDocument()
    expect(screen.getByText('Painel')).toBeInTheDocument()
    expect(screen.getByText('· 20:00')).toBeInTheDocument()
    expect(screen.getByText('Nenhum aviso nesta unidade.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Lago Sul' })).toHaveAttribute('href', `/previsao?unidade=${U2}`)
    expect(screen.getByText('Hoje · Segunda-feira, 05/10/2026')).toBeInTheDocument()
  })

  it('uma unidade só: sem abas', () => {
    render(<Previsao {...base} unidades={[unidades[0]!]} />)
    expect(screen.queryByRole('navigation', { name: 'Filtrar por unidade' })).not.toBeInTheDocument()
  })

  it('atendente não vê Novo aviso nem Cancelar', () => {
    render(<Previsao {...base} podeEditar={false} />)
    expect(screen.queryByRole('button', { name: 'Novo aviso' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Cancelar aviso/ })).not.toBeInTheDocument()
    expect(screen.getByText('Ana')).toBeInTheDocument()
  })

  it('cancelar pede confirmação e só então chama a action', async () => {
    const user = userEvent.setup()
    cancelarAvisoAction.mockResolvedValue({ ok: true, data: null })
    render(<Previsao {...base} />)
    await user.click(screen.getByRole('button', { name: 'Cancelar aviso de Ana, 4 pessoas' }))
    expect(cancelarAvisoAction).not.toHaveBeenCalled()
    const dialogo = await screen.findByRole('dialog')
    await user.click(within(dialogo).getByRole('button', { name: 'Cancelar aviso' }))
    await waitFor(() => expect(cancelarAvisoAction).toHaveBeenCalledWith(unidades[0]!.avisos[0]!.id))
    expect(cancelarAvisoAction).toHaveBeenCalledTimes(1)
  })

  it('cancelados: sem botão, com selo, e link para ocultar', () => {
    const cancelado = aviso({ status: 'cancelado', nome: 'Bia' })
    render(<Previsao {...base} mostrarCancelados unidades={[{ ...unidades[0]!, avisos: [aviso(), cancelado] }]} />)
    expect(screen.getByText('Cancelado')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Cancelar aviso de Bia/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ocultar cancelados' })).toHaveAttribute('href', '/previsao')
  })

  it('estado vazio ensina; dia diferente mostra a data', () => {
    const vazio = unidades.map((u) => ({ ...u, avisos: [], totalPessoas: 0 }))
    const { rerender } = render(<Previsao {...base} unidades={vazio} />)
    expect(screen.getByText('Nenhum aviso para hoje')).toBeInTheDocument()
    expect(screen.getByText('Quando um cliente avisar pelo WhatsApp, aparece aqui.')).toBeInTheDocument()
    rerender(<Previsao {...base} data="2026-10-06" unidades={vazio} />)
    expect(screen.getByText('Nenhum aviso para 06/10/2026')).toBeInTheDocument()
  })

  it('seletor de dia: anterior desativado hoje, limites e input leva à URL', () => {
    const { rerender } = render(<Previsao {...base} />)
    expect(screen.queryByRole('link', { name: 'Dia anterior' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Próximo dia' })).toHaveAttribute('href', '/previsao?data=2026-10-06')
    fireEvent.change(screen.getByLabelText('Escolher o dia'), { target: { value: '2026-10-10' } })
    expect(push).toHaveBeenCalledWith('/previsao?data=2026-10-10')
    rerender(<Previsao {...base} data="2026-11-04" />)
    expect(screen.queryByRole('link', { name: 'Próximo dia' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Dia anterior' })).toHaveAttribute('href', '/previsao?data=2026-11-03')
  })
})

describe('AvisoForm', () => {
  const inicial = { unitId: U1, data: '2026-10-06', pessoas: '', horario: '', nome: '' }
  const props = { inicial, hoje: '2026-10-05', unidades: [{ id: U1, nome: 'Asa Sul' }] }

  it('valida no cliente com a mensagem exata e envia o número', async () => {
    const user = userEvent.setup()
    const acao = vi.fn().mockResolvedValue({ ok: true })
    render(<AvisoForm {...props} acao={acao} />)
    await user.click(screen.getByRole('button', { name: 'Anotar aviso' }))
    expect(screen.getAllByText('Informe de 1 a 60 pessoas.').length).toBeGreaterThan(0)
    expect(acao).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText(/^Pessoas/), '4')
    await user.click(screen.getByRole('button', { name: 'Anotar aviso' }))
    await waitFor(() => expect(acao).toHaveBeenCalledTimes(1))
    expect(acao.mock.calls[0]![0]).toMatchObject({ unitId: U1, data: '2026-10-06', pessoas: 4 })
  })

  it('erro do servidor aparece no campo', async () => {
    const user = userEvent.setup()
    const acao = vi.fn().mockResolvedValue({ ok: false, fieldErrors: { data: 'A unidade não abre nesse dia.' } })
    render(<AvisoForm {...props} inicial={{ ...inicial, pessoas: '2' }} acao={acao} />)
    await user.click(screen.getByRole('button', { name: 'Anotar aviso' }))
    expect(await screen.findByText('A unidade não abre nesse dia.')).toBeInTheDocument()
  })

  it('dois submits seguidos chamam a action uma vez só', async () => {
    let liberar: (v: { ok: true }) => void = () => {}
    const acao = vi.fn().mockImplementation(() => new Promise((r) => { liberar = r }))
    const { container } = render(<AvisoForm {...props} inicial={{ ...inicial, pessoas: '2' }} acao={acao} />)
    const form = container.querySelector('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    await waitFor(() => expect(acao).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 50))
    liberar({ ok: true })
    await waitFor(() => expect(acao).toHaveBeenCalledTimes(1))
  })
})
