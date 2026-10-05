import { beforeEach, describe, expect, it, vi } from 'vitest'

const set = vi.fn()
const revalidatePath = vi.fn()
const requireStaff = vi.fn()
const returnToAi = vi.fn()

vi.mock('next/headers', () => ({ cookies: async () => ({ set }) }))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/dal', () => ({ requireStaff }))
vi.mock('@atd/db', () => ({ returnToAi }))
vi.mock('@/lib/server/db', () => ({ getDb: () => 'db' }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

const { setTheme, returnToAiAction } = await import('./actions')

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

describe('returnToAiAction', () => {
  const id = '11111111-1111-4111-8111-111111111111'
  beforeEach(() => {
    vi.clearAllMocks()
    requireStaff.mockResolvedValue({ role: 'atendente', claims: { sub: 'u' } })
  })

  it('devolve com os claims da sessão e revalida', async () => {
    returnToAi.mockResolvedValue('devolvida')
    expect(await returnToAiAction(id)).toEqual({ resultado: 'devolvida' })
    expect(returnToAi).toHaveBeenCalledWith('db', { sub: 'u' }, id)
    expect(revalidatePath).toHaveBeenCalledWith('/')
  })

  it('id inválido: não chama o banco', async () => {
    expect(await returnToAiAction('x')).toEqual({ resultado: 'nao_encontrada' })
    expect(returnToAi).not.toHaveBeenCalled()
  })

  it('sem sessão: propaga o erro e não chama o banco', async () => {
    requireStaff.mockRejectedValue(new Error('NEXT_REDIRECT'))
    await expect(returnToAiAction(id)).rejects.toThrow('NEXT_REDIRECT')
    expect(returnToAi).not.toHaveBeenCalled()
  })
})
