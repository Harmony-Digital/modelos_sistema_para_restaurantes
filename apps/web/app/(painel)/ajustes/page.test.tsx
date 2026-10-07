import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireStaff = vi.fn()
const lerRestauranteDoPainel = vi.fn()
vi.mock('server-only', () => ({}))
vi.mock('@/lib/dal', () => ({ requireStaff }))
vi.mock('@/lib/server/db', () => ({ getDb: () => 'db' }))
vi.mock('@/lib/server/restaurante', () => ({ lerRestauranteDoPainel }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('@atd/db', () => ({
  carregarUnidadesPainel: async () => ({ restaurante: { nome: 'Casa Harmonia', politicaFeriado: 'normal', politicaUrl: null, timezone: 'America/Sao_Paulo' } }),
  lerHorarioHumano: async () => null,
  modoDemonstracao: async () => false,
}))
vi.mock('../actions', () => ({ setTheme: vi.fn(), signOut: vi.fn() }))
vi.mock('./actions', () => ({ salvarModoDemonstracaoAction: vi.fn(), salvarRestauranteAction: vi.fn() }))
vi.mock('./logo-actions', () => ({ enviarLogoAction: vi.fn(), removerLogoAction: vi.fn() }))
vi.mock('./atendimento-humano/actions', () => ({ salvarHorarioHumanoAction: vi.fn() }))

const { default: AjustesPage } = await import('./page')

describe('Ajustes — logo', () => {
  beforeEach(() => {
    lerRestauranteDoPainel.mockResolvedValue({ nome: 'Casa Harmonia', timezone: 'America/Sao_Paulo', logo: 'https://x.test/marca/r/logo.png' })
  })

  it.each(['dono', 'gerente'] as const)('%s vê o controle da logo com a prévia', async (role) => {
    requireStaff.mockResolvedValue({ role, claims: { sub: 'u' }, restaurantId: 'r' })
    render(await AjustesPage())
    expect(screen.getByLabelText(/^Imagem da logo/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Casa Harmonia' })).toHaveAttribute('src', 'https://x.test/marca/r/logo.png')
    expect(screen.getByRole('button', { name: 'Remover logo' })).toBeInTheDocument()
  })

  it('atendente não vê o controle', async () => {
    requireStaff.mockResolvedValue({ role: 'atendente', claims: { sub: 'u' }, restaurantId: 'r' })
    render(await AjustesPage())
    expect(screen.queryByLabelText(/^Imagem da logo/)).toBeNull()
    expect(screen.queryByRole('button', { name: /logo/i })).toBeNull()
  })
})
