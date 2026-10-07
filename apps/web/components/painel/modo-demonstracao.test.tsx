import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

import { ModoDemonstracao } from './modo-demonstracao'

beforeEach(() => vi.clearAllMocks())

describe('ModoDemonstracao', () => {
  it('explica o modo e o dono liga com um toque', async () => {
    const user = userEvent.setup()
    const acao = vi.fn().mockResolvedValue({ ok: true, data: null })
    render(<ModoDemonstracao ligado={false} acao={acao} />)
    expect(screen.getByText(/aparecem no painel como se fossem reais, marcados .Simulação./)).toBeInTheDocument()
    expect(screen.getByText(/Desligue quando começar a atender clientes reais/)).toBeInTheDocument()
    const chave = screen.getByRole('switch', { name: 'Modo demonstração' })
    expect(chave).toHaveAttribute('aria-checked', 'false')
    await user.click(chave)
    expect(acao).toHaveBeenCalledWith({ ligado: true })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Modo demonstração ligado'))
    expect(chave).toHaveAttribute('aria-checked', 'true')
  })

  it('falha volta a chave e mostra o erro', async () => {
    const user = userEvent.setup()
    const acao = vi.fn().mockResolvedValue({ ok: false, formError: 'Você não tem permissão para isso.' })
    render(<ModoDemonstracao ligado acao={acao} />)
    const chave = screen.getByRole('switch', { name: 'Modo demonstração' })
    await user.click(chave)
    expect(acao).toHaveBeenCalledWith({ ligado: false })
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Você não tem permissão para isso.'))
    expect(chave).toHaveAttribute('aria-checked', 'true')
  })

  it('somente leitura para o gerente', () => {
    render(<ModoDemonstracao ligado acao={vi.fn()} somenteLeitura />)
    expect(screen.getByRole('switch', { name: 'Modo demonstração' })).toBeDisabled()
    expect(screen.getByText(/Só o dono muda/)).toBeInTheDocument()
  })
})
