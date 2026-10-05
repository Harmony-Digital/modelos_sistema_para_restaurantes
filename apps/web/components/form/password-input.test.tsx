import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { PasswordInput } from './password-input'

describe('PasswordInput', () => {
  it('olho mostra e oculta a senha', async () => {
    const user = userEvent.setup()
    render(<label>Senha<PasswordInput defaultValue="segredo123" /></label>)
    const input = screen.getByLabelText('Senha', { exact: true }) as HTMLInputElement
    const olho = screen.getByRole('button', { name: 'Mostrar senha' })
    expect(input.type).toBe('password')
    expect(olho).toHaveAttribute('aria-pressed', 'false')
    await user.click(olho)
    expect(input.type).toBe('text')
    expect(screen.getByRole('button', { name: 'Ocultar senha' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Ocultar senha' }))
    expect(input.type).toBe('password')
  })

  it('volta a ocultar ao enviar o formulário', async () => {
    const user = userEvent.setup()
    render(
      <form onSubmit={(e) => e.preventDefault()}>
        <label>Senha<PasswordInput defaultValue="segredo123" /></label>
        <button type="submit">Entrar</button>
      </form>,
    )
    await user.click(screen.getByRole('button', { name: 'Mostrar senha' }))
    await user.click(screen.getByRole('button', { name: 'Entrar' }))
    expect((screen.getByLabelText('Senha', { exact: true }) as HTMLInputElement).type).toBe('password')
  })

  it('o botão do olho não envia o formulário', async () => {
    const user = userEvent.setup()
    let enviou = false
    render(
      <form onSubmit={(e) => { e.preventDefault(); enviou = true }}>
        <label>Senha<PasswordInput /></label>
      </form>,
    )
    await user.click(screen.getByRole('button', { name: 'Mostrar senha' }))
    expect(enviou).toBe(false)
  })
})
