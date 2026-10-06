import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireStaff = vi.fn()
const salvarModelo = vi.fn()
vi.mock('@/lib/dal', () => ({ requireStaff }))
vi.mock('@/lib/server/db', () => ({ getDb: () => 'db' }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@atd/db', () => ({
  salvarModelo, restaurarModelo: vi.fn(), responderLacuna: vi.fn(), ignorarLacuna: vi.fn(), salvarFato: vi.fn(), removerFato: vi.fn(),
}))

const { salvarModeloAction } = await import('./actions')

describe('salvarModeloAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireStaff.mockResolvedValue({ claims: { sub: 'u' }, restaurantId: 'r' })
  })
  it('chave desconhecida e texto inválido não chegam ao banco', async () => {
    expect(await salvarModeloAction('nao_existe', { texto: 'x' })).toEqual({ ok: false, formError: 'Modelo desconhecido.' })
    expect(await salvarModeloAction('horario_dia', { texto: '{quando}, abrimos.' })).toEqual({
      ok: false, fieldErrors: { texto: 'Inclua {turnos} no texto: é ali que entra a informação.' },
    })
    expect(salvarModelo).not.toHaveBeenCalled()
  })
  it('texto válido é salvo', async () => {
    salvarModelo.mockResolvedValue({ ok: true, valor: null })
    expect(await salvarModeloAction('lacuna', { texto: 'Vou confirmar com a equipe.' })).toEqual({ ok: true, data: null })
    expect(salvarModelo).toHaveBeenCalledWith('db', { sub: 'u' }, 'r', 'lacuna', 'Vou confirmar com a equipe.')
  })
})
