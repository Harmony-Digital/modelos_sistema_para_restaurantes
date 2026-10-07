import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => '/agenda' }))

const { AvisoForm } = await import('./aviso-form')

const U1 = '00000000-0000-4000-8000-000000000001'

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
