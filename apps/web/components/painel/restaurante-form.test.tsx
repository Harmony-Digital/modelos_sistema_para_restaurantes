import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RestauranteForm } from './restaurante-form'

const inicial = { nome: 'Casa Harmonia', politicaFeriado: 'como_domingo' as const, politicaUrl: '' }

describe('RestauranteForm', () => {
  it('explica a política de feriado e valida o link', async () => {
    const user = userEvent.setup()
    const acao = vi.fn().mockResolvedValue({ ok: true, data: null })
    render(<RestauranteForm inicial={inicial} acao={acao} />)
    expect(screen.getByRole('option', { name: 'Abre como no domingo' })).toBeInTheDocument()
    await user.type(screen.getByLabelText(/^Link da política de privacidade/), 'http://casa.test')
    await user.click(screen.getByRole('button', { name: 'Salvar restaurante' }))
    expect(await screen.findByText('Use um link completo que comece com https://')).toBeInTheDocument()
    expect(acao).not.toHaveBeenCalled()
  })
  it('somente leitura para quem não é dono', () => {
    render(<RestauranteForm inicial={inicial} acao={vi.fn()} somenteLeitura />)
    expect(screen.getByLabelText(/^Nome do restaurante/)).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Salvar restaurante' })).toBeNull()
  })
})
