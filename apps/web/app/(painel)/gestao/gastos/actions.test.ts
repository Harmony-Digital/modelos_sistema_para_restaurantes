import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireStaff = vi.fn()
const salvarLimite = vi.fn()
const salvarCotacao = vi.fn()
const revalidatePath = vi.fn()
vi.mock('@/lib/dal', () => ({ requireStaff }))
vi.mock('@/lib/server/db', () => ({ getDb: () => 'db' }))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@atd/db', () => ({ salvarLimite, salvarCotacao }))

const { salvarLimiteAction, salvarCotacaoAction } = await import('./actions')

const limite = (over = {}) => ({ escopo: 'ia' as const, periodo: 'dia' as const, limiteUsd: '2,50', alertaPct: '80', ...over })

beforeEach(() => {
  vi.clearAllMocks()
  requireStaff.mockResolvedValue({ claims: { sub: 'u' }, role: 'dono' })
  salvarLimite.mockResolvedValue({ ok: true, valor: null })
  salvarCotacao.mockResolvedValue({ ok: true, valor: null })
})

describe('salvarLimiteAction', () => {
  it('só o dono: pede o papel antes de validar ou gravar', async () => {
    requireStaff.mockRejectedValue(new Error('NEXT_REDIRECT'))
    await expect(salvarLimiteAction(limite())).rejects.toThrow()
    expect(requireStaff).toHaveBeenCalledWith(['dono'])
    expect(salvarLimite).not.toHaveBeenCalled()
  })

  it('aceita vírgula e grava o valor normalizado; revalida o painel', async () => {
    expect(await salvarLimiteAction(limite())).toEqual({ ok: true, data: null })
    expect(salvarLimite).toHaveBeenCalledWith('db', { sub: 'u' }, { escopo: 'ia', periodo: 'dia', limiteUsd: '2.50', alertaPct: 80 })
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout')
  })

  it('aceita o escopo de simulação e o teto de US$ 10.000', async () => {
    expect((await salvarLimiteAction(limite({ escopo: 'simulacao', periodo: 'mes', limiteUsd: '10000', alertaPct: '100' }))).ok).toBe(true)
    expect(salvarLimite).toHaveBeenCalledWith('db', { sub: 'u' }, { escopo: 'simulacao', periodo: 'mes', limiteUsd: '10000', alertaPct: 100 })
  })

  it('Zod: limite > 0 e ≤ 10.000, alerta 1–100, escopo e período conhecidos', async () => {
    expect(await salvarLimiteAction(limite({ limiteUsd: '0' }))).toMatchObject({ ok: false, fieldErrors: { limiteUsd: 'O limite precisa ser maior que zero' } })
    expect(await salvarLimiteAction(limite({ limiteUsd: '0,000' }))).toMatchObject({ ok: false, fieldErrors: { limiteUsd: 'O limite precisa ser maior que zero' } })
    expect(await salvarLimiteAction(limite({ limiteUsd: '10000,01' }))).toMatchObject({ ok: false, fieldErrors: { limiteUsd: 'Use no máximo US$ 10.000' } })
    expect(await salvarLimiteAction(limite({ limiteUsd: 'abc' }))).toMatchObject({ ok: false, fieldErrors: { limiteUsd: expect.any(String) } })
    expect(await salvarLimiteAction(limite({ limiteUsd: '1,1234567' }))).toMatchObject({ ok: false, fieldErrors: { limiteUsd: expect.any(String) } })
    expect(await salvarLimiteAction(limite({ alertaPct: '0' }))).toMatchObject({ ok: false, fieldErrors: { alertaPct: 'Use um número de 1 a 100' } })
    expect(await salvarLimiteAction(limite({ alertaPct: '101' }))).toMatchObject({ ok: false, fieldErrors: { alertaPct: 'Use um número de 1 a 100' } })
    expect(await salvarLimiteAction(limite({ alertaPct: '8,5' }))).toMatchObject({ ok: false })
    expect((await salvarLimiteAction(limite({ escopo: 'outro' as never }))).ok).toBe(false)
    expect((await salvarLimiteAction(limite({ periodo: 'ano' as never }))).ok).toBe(false)
    expect(salvarLimite).not.toHaveBeenCalled()
  })

  it('recusa do banco vira mensagem em português, sem revalidar', async () => {
    salvarLimite.mockResolvedValue({ ok: false, erro: 'sem_permissao' })
    expect(await salvarLimiteAction(limite())).toEqual({ ok: false, formError: 'Você não tem permissão para fazer essa alteração.' })
    salvarLimite.mockResolvedValue({ ok: false, erro: 'valor_invalido' })
    expect(await salvarLimiteAction(limite())).toEqual({ ok: false, formError: 'Confira os valores informados.' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe('salvarCotacaoAction', () => {
  it('só o dono', async () => {
    requireStaff.mockRejectedValue(new Error('NEXT_REDIRECT'))
    await expect(salvarCotacaoAction({ cotacao: '5,50' })).rejects.toThrow()
    expect(requireStaff).toHaveBeenCalledWith(['dono'])
    expect(salvarCotacao).not.toHaveBeenCalled()
  })

  it('aceita vírgula e grava normalizado', async () => {
    expect(await salvarCotacaoAction({ cotacao: ' 5,4321 ' })).toEqual({ ok: true, data: null })
    expect(salvarCotacao).toHaveBeenCalledWith('db', { sub: 'u' }, '5.4321')
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout')
  })

  it('Zod: cotação entre 0,50 e 50, até 4 casas', async () => {
    for (const cotacao of ['0,49', '50,01', '', 'x', '5,12345']) {
      expect(await salvarCotacaoAction({ cotacao })).toMatchObject({ ok: false, fieldErrors: { cotacao: expect.any(String) } })
    }
    expect((await salvarCotacaoAction({ cotacao: '0,5' })).ok).toBe(true)
    expect((await salvarCotacaoAction({ cotacao: '50' })).ok).toBe(true)
    expect(salvarCotacao).toHaveBeenCalledTimes(2)
  })

  it('valor recusado pelo banco aponta o campo', async () => {
    salvarCotacao.mockResolvedValue({ ok: false, erro: 'valor_invalido' })
    expect(await salvarCotacaoAction({ cotacao: '5' })).toEqual({ ok: false, fieldErrors: { cotacao: 'Confira os valores informados.' } })
  })
})
