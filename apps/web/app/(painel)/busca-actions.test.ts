import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireStaff = vi.fn()
const buscarNoPainel = vi.fn()
const db = { db: true }
vi.mock('@/lib/dal', () => ({ requireStaff }))
vi.mock('@/lib/server/db', () => ({ getDb: () => db }))
vi.mock('@atd/db', () => ({ buscarNoPainel }))

const { buscarNoPainelAction } = await import('./busca-actions')
const sessao = { userId: 'u1', role: 'gerente', restaurantId: 'r1', claims: { sub: 'u1' } }

describe('buscarNoPainelAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireStaff.mockResolvedValue(sessao)
  })

  it('exige sessão do painel e consulta com as claims do usuário (RLS)', async () => {
    buscarNoPainel.mockResolvedValue([{ tipo: 'unidade', id: 'u', titulo: 'Asa Sul', detalhe: null, simulada: false }])
    const r = await buscarNoPainelAction('asa')
    expect(requireStaff).toHaveBeenCalledTimes(1)
    expect(buscarNoPainel).toHaveBeenCalledWith(db, sessao.claims, 'asa')
    expect(r).toEqual({ ok: true, data: [{ tipo: 'unidade', id: 'u', titulo: 'Asa Sul', detalhe: null, simulada: false }] })
  })

  it('termo que não é texto ou longo demais é recusado sem consultar', async () => {
    expect(await buscarNoPainelAction(42)).toEqual({ ok: false, formError: 'Busca inválida.' })
    expect(await buscarNoPainelAction('x'.repeat(201))).toEqual({ ok: false, formError: 'Busca inválida.' })
    expect(buscarNoPainel).not.toHaveBeenCalled()
  })

  it('sem sessão a action não chega à consulta', async () => {
    requireStaff.mockRejectedValue(new Error('NEXT_REDIRECT'))
    await expect(buscarNoPainelAction('asa')).rejects.toThrow('NEXT_REDIRECT')
    expect(buscarNoPainel).not.toHaveBeenCalled()
  })
})
