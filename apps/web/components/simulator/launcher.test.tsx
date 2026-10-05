import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { SimulatorLauncher } from './launcher'

describe('SimulatorLauncher', () => {
  it('abre o simulador com foco no campo de mensagem e fecha com Esc', async () => {
    const user = userEvent.setup()
    render(<SimulatorLauncher restaurante="Casa Teste" />)
    await user.click(screen.getByRole('button', { name: 'Abrir simulador de WhatsApp' }))
    expect(await screen.findByRole('dialog', { name: 'Simulador de WhatsApp' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Mensagem' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Simulador de WhatsApp' })).toBeNull()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Abrir simulador de WhatsApp' })).toHaveFocus())
  })

  it('na 02-A, mensagem enviada vira balão do cliente e aparece o aviso de simulação visual', async () => {
    const user = userEvent.setup()
    render(<SimulatorLauncher restaurante="Casa Teste" />)
    await user.click(screen.getByRole('button', { name: 'Abrir simulador de WhatsApp' }))
    await user.type(await screen.findByRole('textbox', { name: 'Mensagem' }), 'abre domingo?{Enter}')
    expect(screen.getByText('abre domingo?')).toBeInTheDocument()
    expect(screen.getByText(/Simulação visual/)).toBeInTheDocument()
  })
})
