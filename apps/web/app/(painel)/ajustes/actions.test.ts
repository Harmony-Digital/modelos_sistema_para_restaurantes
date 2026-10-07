import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireStaff = vi.fn()
const salvarModoDemonstracao = vi.fn()
const salvarRegrasReserva = vi.fn()
const revalidatePath = vi.fn()
vi.mock('@/lib/dal', () => ({ requireStaff }))
vi.mock('@/lib/server/db', () => ({ getDb: () => 'db' }))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@atd/db', () => ({ salvarRestaurante: vi.fn(), salvarModoDemonstracao, salvarRegrasReserva }))

const { salvarModoDemonstracaoAction, salvarRegrasReservaAction } = await import('./actions')

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

describe('salvarRegrasReservaAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireStaff.mockResolvedValue({ claims: { sub: 'u' }, restaurantId: 'r' })
    salvarRegrasReserva.mockResolvedValue({ ok: true, valor: null })
  })
  it('dono e gerente (atendente não); grava sem espaços nas pontas e revalida Ajustes', async () => {
    expect(await salvarRegrasReservaAction({ texto: '  Tolerância de 15 minutos.  ' })).toEqual({ ok: true, data: null })
    expect(requireStaff).toHaveBeenCalledWith(['dono', 'gerente'])
    expect(salvarRegrasReserva).toHaveBeenCalledWith('db', { sub: 'u' }, 'r', 'Tolerância de 15 minutos.')
    expect(revalidatePath).toHaveBeenCalledWith('/ajustes')
  })
  it('sem sessão de gestão, nada é gravado', async () => {
    requireStaff.mockRejectedValue(new Error('NEXT_REDIRECT'))
    await expect(salvarRegrasReservaAction({ texto: 'x' })).rejects.toThrow()
    expect(salvarRegrasReserva).not.toHaveBeenCalled()
  })
  it('vazio ou acima de 600 caracteres volta no campo sem ir ao banco', async () => {
    expect(await salvarRegrasReservaAction({ texto: 'x'.repeat(601) })).toEqual({ ok: false, fieldErrors: { texto: 'Use no máximo 600 caracteres.' } })
    expect(await salvarRegrasReservaAction({ texto: ' ' })).toEqual({ ok: false, fieldErrors: { texto: 'Escreva as regras da reserva.' } })
    expect(salvarRegrasReserva).not.toHaveBeenCalled()
  })
  it('recusa do banco vira mensagem, sem revalidar', async () => {
    salvarRegrasReserva.mockResolvedValue({ ok: false, erro: 'valor_invalido' })
    expect(await salvarRegrasReservaAction({ texto: 'ok' })).toEqual({ ok: false, fieldErrors: { texto: 'Use de 1 a 600 caracteres.' } })
    salvarRegrasReserva.mockResolvedValue({ ok: false, erro: 'sem_permissao' })
    expect(await salvarRegrasReservaAction({ texto: 'ok' })).toEqual({ ok: false, formError: 'Você não tem permissão para fazer essa alteração.' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
