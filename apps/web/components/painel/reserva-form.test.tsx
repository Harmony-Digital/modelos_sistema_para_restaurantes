import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => '/agenda' }))
const toastSucesso = vi.fn()
vi.mock('sonner', () => ({ toast: { success: toastSucesso, error: vi.fn() } }))

const { ReservaForm } = await import('./reserva-form')

const U1 = '00000000-0000-4000-8000-000000000001'

describe('ReservaForm', () => {
  const inicial = { unitId: U1, data: '2026-10-06', pessoas: '', horario: '', nome: '', contato: '' }
  const props = { inicial, hoje: '2026-10-05', unidades: [{ id: U1, nome: 'Asa Sul' }] }
  const salvar = () => screen.getByRole('button', { name: 'Salvar reserva' })

  it('nome, horário e pessoas são obrigatórios; contato é opcional', async () => {
    const user = userEvent.setup()
    const acao = vi.fn().mockResolvedValue({ ok: true })
    render(<ReservaForm {...props} acao={acao} />)
    expect(screen.getByLabelText(/^Nome/)).toHaveAttribute('aria-required', 'true')
    expect(screen.getByLabelText(/^Horário/)).toHaveAttribute('aria-required', 'true')
    expect(screen.getByLabelText(/^Telefone para contato/)).not.toHaveAttribute('aria-required')
    await user.click(salvar())
    expect(screen.getAllByText('Informe de 1 a 60 pessoas.').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Informe o nome da reserva.').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Informe o horário, como 20:00.').length).toBeGreaterThan(0)
    expect(acao).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText(/^Pessoas/), '4')
    await user.type(screen.getByLabelText(/^Horário/), '2030')
    await user.type(screen.getByLabelText(/^Nome/), 'Ana')
    await user.click(salvar())
    await waitFor(() => expect(acao).toHaveBeenCalledTimes(1))
    expect(acao.mock.calls[0]![0]).toMatchObject({ unitId: U1, data: '2026-10-06', pessoas: 4, horario: '20:30', nome: 'Ana', contato: null })
    expect(toastSucesso).toHaveBeenCalledWith('Reserva anotada.')
  })

  it('telefone de contato inválido não envia', async () => {
    const user = userEvent.setup()
    const acao = vi.fn()
    render(<ReservaForm {...props} inicial={{ ...inicial, pessoas: '2', horario: '20:00', nome: 'Ana', contato: '9999-8888' }} acao={acao} />)
    await user.click(salvar())
    expect(await screen.findByText('Informe o telefone com DDD, como (61) 99999-8888.')).toBeInTheDocument()
    expect(acao).not.toHaveBeenCalled()
  })

  it('erro do servidor aparece no campo; lotado aparece no formulário', async () => {
    const user = userEvent.setup()
    const acao = vi.fn().mockResolvedValue({ ok: false, fieldErrors: { data: 'A unidade não abre nesse dia.' } })
    const cheio = { ...inicial, pessoas: '2', horario: '20:00', nome: 'Ana' }
    const { unmount } = render(<ReservaForm {...props} inicial={cheio} acao={acao} />)
    await user.click(salvar())
    expect(await screen.findByText('A unidade não abre nesse dia.')).toBeInTheDocument()
    unmount()
    acao.mockResolvedValue({ ok: false, formError: 'A unidade está lotada nesse dia. Restam 3 vagas.' })
    render(<ReservaForm {...props} inicial={cheio} acao={acao} />)
    await user.click(salvar())
    expect(await screen.findByText('A unidade está lotada nesse dia. Restam 3 vagas.')).toBeInTheDocument()
  })

  it('dois submits seguidos chamam a action uma vez só', async () => {
    let liberar: (v: { ok: true }) => void = () => {}
    const acao = vi.fn().mockImplementation(() => new Promise((r) => { liberar = r }))
    const { container } = render(<ReservaForm {...props} inicial={{ ...inicial, pessoas: '2', horario: '20:00', nome: 'Ana' }} acao={acao} />)
    const form = container.querySelector('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    await waitFor(() => expect(acao).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 50))
    liberar({ ok: true })
    await waitFor(() => expect(acao).toHaveBeenCalledTimes(1))
  })
})
