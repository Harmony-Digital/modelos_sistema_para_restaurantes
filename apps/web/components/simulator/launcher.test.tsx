import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it } from 'vitest'
import { SimulatorLauncher } from './launcher'

describe('SimulatorLauncher', () => {
  // O diálogo vem por next/dynamic; pré-carregar o chunk evita que a 1ª importação no jsdom estoure o tempo sob carga.
  beforeAll(async () => {
    await import('./simulator-dialog')
  })

  it('abre o simulador com foco no campo de mensagem e fecha com Esc', async () => {
    const user = userEvent.setup()
    render(<SimulatorLauncher restaurante="Casa Teste" />)
    await user.click(screen.getByRole('button', { name: 'Abrir simulador de WhatsApp' }))
    expect(await screen.findByRole('dialog', { name: 'Simulador de WhatsApp' }, { timeout: 5000 })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Mensagem' })).toHaveFocus())
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Simulador de WhatsApp' })).toBeNull())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Abrir simulador de WhatsApp' })).toHaveFocus())
  })

  it('na 02-A, mensagem enviada vira balão do cliente e aparece o aviso de simulação visual', async () => {
    const user = userEvent.setup()
    render(<SimulatorLauncher restaurante="Casa Teste" />)
    await user.click(screen.getByRole('button', { name: 'Abrir simulador de WhatsApp' }))
    await user.type(await screen.findByRole('textbox', { name: 'Mensagem' }, { timeout: 5000 }), 'abre domingo?{Enter}')
    expect(screen.getByText('abre domingo?')).toBeInTheDocument()
    expect(screen.getByText(/Simulação visual/)).toBeInTheDocument()
  })
})
