import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireStaff = vi.fn()
const atualizarPedido = vi.fn()
const revelarTelefonePedido = vi.fn()
const revalidatePath = vi.fn()
const PHONE_KEY = Buffer.alloc(32, 7)
vi.mock('@/lib/dal', () => ({ requireStaff }))
vi.mock('@/lib/server/db', () => ({ getDb: () => 'db' }))
vi.mock('@/lib/server/env', () => ({ env: () => ({ phoneKey: PHONE_KEY }) }))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@atd/db', () => ({ atualizarPedido, revelarTelefonePedido }))

const { atualizarPedidoAction, revelarTelefoneAction } = await import('./eventos-actions')

const P = '00000000-0000-4000-8000-0000000000aa'
const U = '00000000-0000-4000-8000-000000000001'
const valores = (over = {}) => ({ status: 'em_contato' as const, responsavelId: U, notasInternas: ' ligar amanhã ', ...over })

beforeEach(() => {
  vi.clearAllMocks()
  requireStaff.mockResolvedValue({ claims: { sub: 'u' }, restaurantId: 'r', role: 'atendente' })
  atualizarPedido.mockResolvedValue({ ok: true, valor: null })
  revelarTelefonePedido.mockResolvedValue({ ok: true, valor: { telefone: '+5561999990000' } })
})

describe('eventos: atualizarPedidoAction', () => {
  it('exige sessão (todos os papéis) antes de tudo', async () => {
    requireStaff.mockRejectedValue(new Error('NEXT_REDIRECT'))
    await expect(atualizarPedidoAction(P, valores())).rejects.toThrow()
    expect(requireStaff).toHaveBeenCalledWith()
    expect(atualizarPedido).not.toHaveBeenCalled()
  })

  it('Zod antes do banco: notas longas, status inválido, id inválido', async () => {
    expect(await atualizarPedidoAction(P, valores({ notasInternas: 'x'.repeat(2001) }))).toEqual({
      ok: false, fieldErrors: { notasInternas: 'Use no máximo 2000 caracteres' },
    })
    const r = await atualizarPedidoAction(P, valores({ status: 'reservado' as never }))
    expect(r.ok).toBe(false)
    expect(await atualizarPedidoAction('x', valores())).toEqual({ ok: false, formError: 'Esse pedido não está mais disponível.' })
    expect(atualizarPedido).not.toHaveBeenCalled()
  })

  it('normaliza ("Ninguém" e notas vazias viram null) e revalida', async () => {
    expect(await atualizarPedidoAction(P, valores())).toEqual({ ok: true, data: null })
    expect(atualizarPedido).toHaveBeenCalledWith('db', { sub: 'u' }, P, { status: 'em_contato', responsavelId: U, notasInternas: 'ligar amanhã' })
    expect(revalidatePath).toHaveBeenCalledWith('/agenda')
    await atualizarPedidoAction(P, valores({ responsavelId: '', notasInternas: '  ' }))
    expect(atualizarPedido).toHaveBeenLastCalledWith('db', { sub: 'u' }, P, { status: 'em_contato', responsavelId: null, notasInternas: null })
  })

  it('mapeia os erros do banco', async () => {
    atualizarPedido.mockResolvedValue({ ok: false, erro: 'transicao_invalida' })
    expect(await atualizarPedidoAction(P, valores())).toEqual({ ok: false, fieldErrors: { status: 'Esse status não pode mais ser alterado assim.' } })
    atualizarPedido.mockResolvedValue({ ok: false, erro: 'nao_encontrada' })
    expect(await atualizarPedidoAction(P, valores())).toEqual({ ok: false, formError: 'Esse pedido não está mais disponível.' })
    atualizarPedido.mockResolvedValue({ ok: false, erro: 'sem_permissao' })
    expect(await atualizarPedidoAction(P, valores())).toEqual({ ok: false, formError: 'Você não tem permissão para fazer essa alteração.' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe('eventos: revelarTelefoneAction', () => {
  it('exige sessão e valida o id antes do banco', async () => {
    requireStaff.mockRejectedValue(new Error('NEXT_REDIRECT'))
    await expect(revelarTelefoneAction(P)).rejects.toThrow()
    requireStaff.mockResolvedValue({ claims: { sub: 'u' } })
    expect(await revelarTelefoneAction('x')).toEqual({ ok: false, formError: 'Esse pedido não está mais disponível.' })
    expect(revelarTelefonePedido).not.toHaveBeenCalled()
  })

  it('devolve o telefone (chave vem do env no servidor) e não revalida nada', async () => {
    expect(await revelarTelefoneAction(P)).toEqual({ ok: true, data: { telefone: '+5561999990000' } })
    expect(revelarTelefonePedido).toHaveBeenCalledWith('db', { sub: 'u' }, P, PHONE_KEY)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('sem telefone ou sem acesso: mensagem do painel', async () => {
    revelarTelefonePedido.mockResolvedValue({ ok: false, erro: 'nao_encontrada' })
    expect(await revelarTelefoneAction(P)).toEqual({ ok: false, formError: 'Esse pedido não está mais disponível.' })
  })
})
