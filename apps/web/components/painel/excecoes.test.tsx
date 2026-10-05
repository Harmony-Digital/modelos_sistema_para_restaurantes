import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ExcecaoForm } from './excecao-form'

describe('ExcecaoForm', () => {
  it('data inválida avisa; aberta sem turno pede turno; fechado esconde os turnos', async () => {
    const user = userEvent.setup()
    const acao = vi.fn().mockResolvedValue({ ok: true, data: null })
    render(<ExcecaoForm inicial={{ data: '', fechado: false, turnos: [], motivo: '' }} acao={acao} />)
    await user.type(screen.getByLabelText(/^Data/), '31022026')
    await user.click(screen.getByRole('button', { name: 'Salvar exceção' }))
    expect(await screen.findByText('Data inexistente. Use dd/mm/aaaa, como 12/10/2026')).toBeInTheDocument()
    expect(acao).not.toHaveBeenCalled()

    // a regra do formulário inteiro (turno obrigatório) só roda com os campos válidos
    await user.clear(screen.getByLabelText(/^Data/))
    await user.type(screen.getByLabelText(/^Data/), '24122026')
    await user.click(screen.getByRole('button', { name: 'Salvar exceção' }))
    expect(await screen.findByText('Adicione pelo menos um turno ou marque "Fechado o dia todo".')).toBeInTheDocument()
    expect(acao).not.toHaveBeenCalled()

    await user.click(screen.getByRole('switch', { name: 'Fechado o dia todo' }))
    expect(screen.queryByRole('button', { name: 'Adicionar turno' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Salvar exceção' }))
    expect(acao).toHaveBeenCalledWith({ data: '24/12/2026', fechado: true, turnos: [], motivo: '' })
  })
})
