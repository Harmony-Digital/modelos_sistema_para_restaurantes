import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const signIn = vi.hoisted(() => vi.fn())
const replace = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { signInWithPassword: signIn } }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh: vi.fn() }) }))

import { LoginForm } from './login-form'

beforeEach(() => { signIn.mockReset(); replace.mockReset() })

describe('LoginForm', () => {
  it('valida antes de chamar o Supabase', async () => {
    const user = userEvent.setup()
    render(<LoginForm semAcesso={false} />)
    await user.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(signIn).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/E-mail/)).toHaveFocus()
  })

  it('senha errada: erro no campo Senha com foco nele', async () => {
    const user = userEvent.setup()
    signIn.mockResolvedValue({ error: { code: 'invalid_credentials', message: 'Invalid login credentials' } })
    render(<LoginForm semAcesso={false} />)
    await user.type(screen.getByLabelText(/E-mail/), 'dono@restaurante.com.br')
    await user.type(screen.getByLabelText(/^Senha/), 'errada123')
    await user.click(screen.getByRole('button', { name: 'Entrar' }))
    const senha = screen.getByLabelText(/^Senha/)
    expect(senha).toHaveAttribute('aria-invalid', 'true')
    expect(senha).toHaveAccessibleDescription(/E-mail ou senha incorretos/)
    expect(senha).toHaveFocus()
    expect(replace).not.toHaveBeenCalled()
  })

  it('erro que não é de credencial (limite/rede): aviso geral, sem culpar a senha', async () => {
    const user = userEvent.setup()
    signIn.mockResolvedValue({ error: { code: 'over_request_rate_limit', message: 'rate limit' } })
    render(<LoginForm semAcesso={false} />)
    await user.type(screen.getByLabelText(/E-mail/), 'dono@restaurante.com.br')
    await user.type(screen.getByLabelText(/^Senha/), 'Restaurante2026')
    await user.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível entrar agora')
    expect(screen.getByLabelText(/^Senha/)).not.toHaveAttribute('aria-invalid', 'true')
    expect(replace).not.toHaveBeenCalled()
  })

  it('sucesso navega para o painel', async () => {
    const user = userEvent.setup()
    signIn.mockResolvedValue({ error: null })
    render(<LoginForm semAcesso={false} />)
    await user.type(screen.getByLabelText(/E-mail/), 'dono@restaurante.com.br')
    await user.type(screen.getByLabelText(/^Senha/), 'Restaurante2026')
    await user.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(signIn).toHaveBeenCalledWith({ email: 'dono@restaurante.com.br', password: 'Restaurante2026' })
    expect(replace).toHaveBeenCalledWith('/')
  })

  it('sem acesso: aviso visível no formulário', () => {
    render(<LoginForm semAcesso />)
    expect(screen.getByRole('alert')).toHaveTextContent('Este usuário não tem acesso ao painel')
  })
})
