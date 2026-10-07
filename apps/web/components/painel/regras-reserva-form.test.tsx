import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

const toastSucesso = vi.fn()
vi.mock('sonner', () => ({ toast: { success: toastSucesso, error: vi.fn() } }))

const { RegrasReservaForm } = await import('./regras-reserva-form')

const PADRAO = 'Sua reserva está confirmada! Guardamos o lugar por até 15 minutos.'
const campo = () => screen.getByLabelText(/^Regras enviadas depois da reserva/)

describe('RegrasReservaForm', () => {
  it('contador de caracteres de 600 acompanha o texto', async () => {
    const user = userEvent.setup()
    render(<RegrasReservaForm inicial="Tolerância." padrao={PADRAO} acao={vi.fn()} />)
    expect(screen.getByText('11/600')).toBeInTheDocument()
    await user.type(campo(), ' Ok')
    expect(screen.getByText('14/600')).toBeInTheDocument()
  })

  it('acima de 600 caracteres: erro no campo e nada enviado', async () => {
    const user = userEvent.setup()
    const acao = vi.fn()
    render(<RegrasReservaForm inicial={'x'.repeat(601)} padrao={PADRAO} acao={acao} />)
    expect(screen.getByText('601/600')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Salvar regras' }))
    expect(await screen.findByText('Use no máximo 600 caracteres.')).toBeInTheDocument()
    expect(acao).not.toHaveBeenCalled()
  })

  it('Restaurar padrão põe o texto padrão no campo (só grava ao salvar)', async () => {
    const user = userEvent.setup()
    const acao = vi.fn().mockResolvedValue({ ok: true, data: null })
    render(<RegrasReservaForm inicial="Tolerância." padrao={PADRAO} acao={acao} />)
    await user.click(screen.getByRole('button', { name: 'Restaurar padrão' }))
    expect(campo()).toHaveValue(PADRAO)
    expect(acao).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Salvar regras' }))
    await waitFor(() => expect(acao).toHaveBeenCalledWith({ texto: PADRAO }))
    expect(toastSucesso).toHaveBeenCalledWith('Regras da reserva salvas.')
  })

  it('texto já igual ao padrão: Restaurar padrão fica desativado', () => {
    render(<RegrasReservaForm inicial={PADRAO} padrao={PADRAO} acao={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Restaurar padrão' })).toBeDisabled()
  })

  it('igual ao padrão a menos de espaços nas pontas (o salvar apara): Restaurar padrão fica desativado', () => {
    render(<RegrasReservaForm inicial={`  ${PADRAO}\n`} padrao={PADRAO} acao={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Restaurar padrão' })).toBeDisabled()
  })

  it('erro do servidor aparece no campo', async () => {
    const user = userEvent.setup()
    const acao = vi.fn().mockResolvedValue({ ok: false, fieldErrors: { texto: 'Use de 1 a 600 caracteres.' } })
    render(<RegrasReservaForm inicial="Tolerância." padrao={PADRAO} acao={acao} />)
    await user.click(screen.getByRole('button', { name: 'Salvar regras' }))
    expect(await screen.findByText('Use de 1 a 600 caracteres.')).toBeInTheDocument()
  })
})
