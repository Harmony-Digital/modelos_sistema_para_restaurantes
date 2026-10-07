import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireStaff = vi.fn()
const salvarModoDemonstracao = vi.fn()
const revalidatePath = vi.fn()
vi.mock('@/lib/dal', () => ({ requireStaff }))
vi.mock('@/lib/server/db', () => ({ getDb: () => 'db' }))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@atd/db', () => ({ salvarRestaurante: vi.fn(), salvarModoDemonstracao }))

const { salvarModoDemonstracaoAction } = await import('./actions')

describe('salvarModoDemonstracaoAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireStaff.mockResolvedValue({ claims: { sub: 'u' }, restaurantId: 'r' })
  })
  it('só o dono; grava e revalida o painel todo', async () => {
    salvarModoDemonstracao.mockResolvedValue({ ok: true, valor: null })
    expect(await salvarModoDemonstracaoAction({ ligado: true })).toEqual({ ok: true, data: null })
    expect(requireStaff).toHaveBeenCalledWith(['dono'])
    expect(salvarModoDemonstracao).toHaveBeenCalledWith('db', { sub: 'u' }, 'r', true)
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout')
  })
  it('entrada inválida não chega ao banco', async () => {
    const r = await salvarModoDemonstracaoAction({ ligado: 'sim' } as never)
    expect(r.ok).toBe(false)
    expect(salvarModoDemonstracao).not.toHaveBeenCalled()
  })
  it('recusa do banco vira mensagem em português, sem revalidar', async () => {
    salvarModoDemonstracao.mockResolvedValue({ ok: false, erro: 'sem_permissao' })
    expect(await salvarModoDemonstracaoAction({ ligado: false })).toEqual({ ok: false, formError: 'Você não tem permissão para fazer essa alteração.' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
