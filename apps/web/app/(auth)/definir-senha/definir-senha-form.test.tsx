import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DefinirSenhaForm } from './definir-senha-form'

describe('DefinirSenhaForm', () => {
  it('senhas diferentes: erro no campo de confirmação', async () => {
    const user = userEvent.setup()
    const action = vi.fn()
    render(<DefinirSenhaForm action={action} />)
    await user.type(screen.getByLabelText(/^Nova senha/), 'Restaurante2026')
    await user.type(screen.getByLabelText(/^Confirme a senha/), 'Restaurante2025')
    await user.click(screen.getByRole('button', { name: 'Salvar senha' }))
    const confirma = screen.getByLabelText(/^Confirme a senha/)
    expect(confirma).toHaveAttribute('aria-invalid', 'true')
    expect(confirma).toHaveAccessibleDescription(/As senhas não conferem/)
    expect(action).not.toHaveBeenCalled()
  })

  it('senha fraca explica a regra no campo', async () => {
    const user = userEvent.setup()
    render(<DefinirSenhaForm action={vi.fn()} />)
    await user.type(screen.getByLabelText(/^Nova senha/), 'curta')
    await user.tab()
    expect(screen.getByLabelText(/^Nova senha/)).toHaveAccessibleDescription(/pelo menos 12 caracteres/)
  })

  it('erro do servidor aparece no campo da nova senha', async () => {
    const user = userEvent.setup()
    const action = vi.fn(async () => ({ ok: false as const, fieldErrors: { senha: 'Escolha uma senha diferente da anterior' } }))
    render(<DefinirSenhaForm action={action} />)
    await user.type(screen.getByLabelText(/^Nova senha/), 'Restaurante2026')
    await user.type(screen.getByLabelText(/^Confirme a senha/), 'Restaurante2026')
    await user.click(screen.getByRole('button', { name: 'Salvar senha' }))
    expect(screen.getByLabelText(/^Nova senha/)).toHaveAccessibleDescription(/Escolha uma senha diferente/)
  })
})
