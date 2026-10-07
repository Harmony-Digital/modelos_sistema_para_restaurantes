import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireStaff = vi.fn()
const criarConvite = vi.fn()
const reenviarConvite = vi.fn()
const definirAtivo = vi.fn()
const enviar = vi.fn()
const enqueueConvite = vi.fn(() => enviar)
const getBoss = vi.fn(async () => 'boss')
const revalidatePath = vi.fn()
vi.mock('@/lib/dal', () => ({ requireStaff }))
vi.mock('@/lib/server/db', () => ({ getDb: () => 'db' }))
vi.mock('@/lib/server/boss', () => ({ getBoss }))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@atd/db', () => ({ criarConvite, reenviarConvite, definirAtivo, enqueueConvite }))

const { criarConviteAction, reenviarConviteAction, definirAtivoAction } = await import('./actions')

const U = '00000000-0000-4000-8000-0000000000aa'
const C = '00000000-0000-4000-8000-0000000000cc'
const valido = { email: ' Ana@Casa.com ', nome: 'Ana', papel: 'atendente' as const, todas: false, unidades: [U] }

beforeEach(() => {
  vi.clearAllMocks()
  requireStaff.mockResolvedValue({ claims: { sub: 'dono' }, role: 'dono', userId: 'dono' })
  criarConvite.mockResolvedValue({ ok: true, valor: { conviteId: C } })
  reenviarConvite.mockResolvedValue({ ok: true, valor: null })
  definirAtivo.mockResolvedValue({ ok: true, valor: null })
  enviar.mockResolvedValue('job')
})

describe('convidar', () => {
  it('só o dono: pede o papel antes de tudo (gerente/atendente são barrados pelo requireStaff)', async () => {
    requireStaff.mockRejectedValue(new Error('NEXT_REDIRECT'))
    await expect(criarConviteAction(valido)).rejects.toThrow()
    expect(requireStaff).toHaveBeenCalledWith(['dono'])
    expect(criarConvite).not.toHaveBeenCalled()
  })

  it('cria o convite com e-mail normalizado e enfileira depois do commit', async () => {
    const r = await criarConviteAction(valido)
    expect(r).toEqual({ ok: true, data: { conviteId: C } })
    expect(criarConvite).toHaveBeenCalledWith('db', { sub: 'dono' }, { email: 'ana@casa.com', nome: 'Ana', papel: 'atendente', unidades: [U] })
    expect(enviar).toHaveBeenCalledWith(C)
    expect(criarConvite.mock.invocationCallOrder[0]).toBeLessThan(enviar.mock.invocationCallOrder[0]!)
  })

  it('todas as unidades vira "todas"', async () => {
    await criarConviteAction({ ...valido, todas: true, unidades: [] })
    expect(criarConvite).toHaveBeenCalledWith('db', { sub: 'dono' }, expect.objectContaining({ unidades: 'todas' }))
  })

  it('e-mail inválido, papel dono e sem unidade não chegam ao banco', async () => {
    expect((await criarConviteAction({ ...valido, email: 'sem-arroba' })).ok).toBe(false)
    expect((await criarConviteAction({ ...valido, papel: 'dono' as never })).ok).toBe(false)
    const r = await criarConviteAction({ ...valido, unidades: [] })
    expect(r).toMatchObject({ ok: false, fieldErrors: { unidades: 'Escolha ao menos uma unidade' } })
    expect(criarConvite).not.toHaveBeenCalled()
    expect(enviar).not.toHaveBeenCalled()
  })

  it('e-mail já existente vira erro do campo, sem enfileirar', async () => {
    criarConvite.mockResolvedValue({ ok: false, erro: 'ja_existe' })
    const r = await criarConviteAction(valido)
    expect(r).toMatchObject({ ok: false, fieldErrors: { email: expect.stringContaining('já') } })
    expect(enviar).not.toHaveBeenCalled()
  })

  it('falha da fila avisa para reenviar (o convite já foi salvo)', async () => {
    enviar.mockRejectedValue(new Error('fila fora'))
    const r = await criarConviteAction(valido)
    expect(r).toMatchObject({ ok: false, formError: expect.stringContaining('Reenviar convite') })
    expect(revalidatePath).toHaveBeenCalledWith('/gestao/equipe')
  })
})

describe('reenviar', () => {
  it('só o dono; id inválido não chega ao banco', async () => {
    expect((await reenviarConviteAction('x')).ok).toBe(false)
    expect(reenviarConvite).not.toHaveBeenCalled()
    expect(requireStaff).toHaveBeenCalledWith(['dono'])
  })

  it('volta a pendente e enfileira', async () => {
    expect(await reenviarConviteAction(C)).toEqual({ ok: true, data: null })
    expect(reenviarConvite).toHaveBeenCalledWith('db', { sub: 'dono' }, C)
    expect(enviar).toHaveBeenCalledWith(C)
  })

  it('convite que não existe devolve mensagem amigável e não enfileira', async () => {
    reenviarConvite.mockResolvedValue({ ok: false, erro: 'nao_encontrada' })
    expect(await reenviarConviteAction(C)).toMatchObject({ ok: false, formError: expect.stringContaining('Não encontramos') })
    expect(enviar).not.toHaveBeenCalled()
  })
})

describe('desativar', () => {
  it('só o dono; desativa e reativa', async () => {
    expect(await definirAtivoAction(U, false)).toEqual({ ok: true, data: null })
    expect(definirAtivo).toHaveBeenCalledWith('db', { sub: 'dono' }, U, false)
    await definirAtivoAction(U, true)
    expect(definirAtivo).toHaveBeenLastCalledWith('db', { sub: 'dono' }, U, true)
    expect(requireStaff).toHaveBeenCalledWith(['dono'])
  })

  it('não a si mesmo', async () => {
    definirAtivo.mockResolvedValue({ ok: false, erro: 'a_si_mesmo' })
    expect(await definirAtivoAction(U, false)).toMatchObject({ ok: false, formError: 'Você não pode desativar o próprio acesso.' })
  })

  it('id inválido não chega ao banco', async () => {
    expect((await definirAtivoAction('x', false)).ok).toBe(false)
    expect(definirAtivo).not.toHaveBeenCalled()
  })
})
