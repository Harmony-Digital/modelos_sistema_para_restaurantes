import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const marcaDoLogin = vi.fn()
vi.mock('@atd/db', () => ({ marcaDoLogin }))
vi.mock('@/lib/server/db', () => ({ getDb: () => 'db' }))
vi.mock('./login-form', () => ({ LoginForm: () => <form aria-label="Entrar" /> }))

const { default: LoginPage } = await import('./page')
const pagina = async () => render(await LoginPage({ searchParams: Promise.resolve({}) }))

describe('LoginPage — marca do restaurante', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abc.supabase.co')
  })

  it('com exatamente um restaurante e logo: logo (32 px) e nome no lugar do título padrão', async () => {
    marcaDoLogin.mockResolvedValue({ nome: 'Casa Harmonia', logoPath: 'r1/logo-x.png' })
    await pagina()
    expect(marcaDoLogin).toHaveBeenCalledWith('db')
    const img = screen.getByRole('img', { name: 'Casa Harmonia' })
    expect(img).toHaveAttribute('src', 'https://abc.supabase.co/storage/v1/object/public/marca/r1/logo-x.png')
    expect(img).toHaveAttribute('width', '32')
    expect(screen.getByText('Casa Harmonia').className).toContain('truncate')
    expect(screen.queryByText('Atendimento')).toBeNull()
  })

  it('com mais de um restaurante (nada), sem logo ou com o banco fora: a tela de hoje', async () => {
    for (const mock of [
      () => marcaDoLogin.mockResolvedValue(null),
      () => marcaDoLogin.mockResolvedValue({ nome: 'Casa Harmonia', logoPath: null }),
      () => marcaDoLogin.mockRejectedValue(new Error('banco fora')),
    ]) {
      mock()
      const { unmount } = await pagina()
      expect(screen.queryByRole('img')).toBeNull()
      expect(screen.queryByText('Casa Harmonia')).toBeNull()
      expect(screen.getByText('Atendimento')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Entrar no painel' })).toBeInTheDocument()
      unmount()
    }
  })
})
