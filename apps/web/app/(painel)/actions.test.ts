import { beforeEach, describe, expect, it, vi } from 'vitest'

const set = vi.fn()
const revalidatePath = vi.fn()
const requireStaff = vi.fn()

vi.mock('next/headers', () => ({ cookies: async () => ({ set }) }))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/dal', () => ({ requireStaff }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

const { setTheme } = await import('./actions')

function fd(tema: string) {
  const f = new FormData()
  f.set('tema', tema)
  return f
}

describe('setTheme', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireStaff.mockResolvedValue({ role: 'dono' })
  })

  it('grava o cookie com os atributos e revalida o layout', async () => {
    await setTheme(fd('claro'))
    expect(set).toHaveBeenCalledWith('atd-tema', 'claro', {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
      httpOnly: true,
      secure: false,
    })
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout')
  })

  it('ignora valor inválido', async () => {
    await setTheme(fd('roxo'))
    expect(set).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('sem sessão: não grava cookie e propaga o erro', async () => {
    requireStaff.mockRejectedValue(new Error('NEXT_REDIRECT'))
    await expect(setTheme(fd('claro'))).rejects.toThrow('NEXT_REDIRECT')
    expect(set).not.toHaveBeenCalled()
  })
})
