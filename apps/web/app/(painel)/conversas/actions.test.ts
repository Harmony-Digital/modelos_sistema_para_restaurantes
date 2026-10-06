import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireStaff = vi.fn()
const assumirConversa = vi.fn()
const responderConversa = vi.fn()
const reenviarMensagem = vi.fn()
const devolverConversa = vi.fn()
const encerrarConversa = vi.fn()
const revelarTelefoneConversa = vi.fn()
const enfileirar = vi.fn()
const enqueueDeliver = vi.fn(() => enfileirar)
const revalidatePath = vi.fn()
vi.mock('@/lib/dal', () => ({ requireStaff }))
vi.mock('@/lib/server/db', () => ({ getDb: () => 'db' }))
vi.mock('@/lib/server/boss', () => ({ getBoss: async () => 'boss' }))
vi.mock('@/lib/server/env', () => ({ env: () => ({ phoneKey: 'chave' }) }))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@atd/db', () => ({
  assumirConversa, responderConversa, reenviarMensagem, devolverConversa, encerrarConversa, revelarTelefoneConversa, enqueueDeliver,
}))

const A = await import('./actions')

const ID = '11111111-1111-4111-8111-111111111111'
const TODOS = ['dono', 'gerente', 'atendente']
const JANELA = 'O cliente não escreve há mais de 24 h. O WhatsApp só permite responder quando ele mandar uma nova mensagem.'

beforeEach(() => {
  vi.clearAllMocks()
  requireStaff.mockResolvedValue({ claims: { sub: 'u' }, role: 'atendente', userId: 'u', restaurantId: 'r' })
  enfileirar.mockResolvedValue('job')
})

describe('sem sessão', () => {
  it('toda action propaga o redirect e não toca o banco', async () => {
    requireStaff.mockRejectedValue(new Error('NEXT_REDIRECT'))
    await expect(A.assumirAction(ID, {})).rejects.toThrow('NEXT_REDIRECT')
    await expect(A.responderAction(ID, { texto: 'oi' })).rejects.toThrow('NEXT_REDIRECT')
    await expect(A.reenviarAction(1)).rejects.toThrow('NEXT_REDIRECT')
    await expect(A.devolverAction(ID)).rejects.toThrow('NEXT_REDIRECT')
    await expect(A.encerrarAction(ID)).rejects.toThrow('NEXT_REDIRECT')
    await expect(A.mostrarTelefoneConversaAction(ID)).rejects.toThrow('NEXT_REDIRECT')
    for (const f of [assumirConversa, responderConversa, reenviarMensagem, devolverConversa, encerrarConversa, revelarTelefoneConversa]) {
      expect(f).not.toHaveBeenCalled()
    }
  })
})

describe('assumirAction', () => {
  it('exige papel da equipe e assume com os claims', async () => {
    assumirConversa.mockResolvedValue({ ok: true })
    expect(await A.assumirAction(ID, {})).toEqual({ ok: true, data: null })
    expect(requireStaff).toHaveBeenCalledWith(TODOS)
    expect(assumirConversa).toHaveBeenCalledWith('db', { sub: 'u' }, ID, { forcar: false })
    expect(revalidatePath).toHaveBeenCalledWith('/conversas', 'layout')
  })
  it('atendente não pode forçar', async () => {
    const r = await A.assumirAction(ID, { forcar: true })
    expect(r).toEqual({ ok: false, formError: 'Só o dono ou o gerente podem assumir uma conversa que já está com outra pessoa.' })
    expect(assumirConversa).not.toHaveBeenCalled()
  })
  it('gerente pode forçar', async () => {
    requireStaff.mockResolvedValue({ claims: { sub: 'g' }, role: 'gerente' })
    assumirConversa.mockResolvedValue({ ok: true })
    await A.assumirAction(ID, { forcar: true })
    expect(assumirConversa).toHaveBeenCalledWith('db', { sub: 'g' }, ID, { forcar: true })
  })
  it('já atendida: "Fulano já está atendendo"', async () => {
    assumirConversa.mockResolvedValue({ ok: false, erro: 'ja_atendida', atendente: 'Bia' })
    expect(await A.assumirAction(ID, {})).toEqual({ ok: false, formError: 'Bia já está atendendo esta conversa.' })
    assumirConversa.mockResolvedValue({ ok: false, erro: 'ja_atendida' })
    expect(await A.assumirAction(ID, {})).toEqual({ ok: false, formError: 'Outra pessoa já está atendendo esta conversa.' })
  })
  it('id inválido não chama o banco', async () => {
    expect(await A.assumirAction('x', {})).toMatchObject({ ok: false })
    expect(assumirConversa).not.toHaveBeenCalled()
  })
})

describe('responderAction', () => {
  it('grava e enfileira a entrega só depois do sucesso', async () => {
    responderConversa.mockResolvedValue({ ok: true, messageId: 7 })
    expect(await A.responderAction(ID, { texto: '  Olá!  ' })).toEqual({ ok: true, data: { messageId: 7, envioAtrasado: false } })
    expect(responderConversa).toHaveBeenCalledWith('db', { sub: 'u' }, ID, 'Olá!')
    expect(enqueueDeliver).toHaveBeenCalledWith('boss')
    expect(enfileirar).toHaveBeenCalledWith(ID)
    expect(responderConversa.mock.invocationCallOrder[0]!).toBeLessThan(enfileirar.mock.invocationCallOrder[0]!)
  })
  it('texto vazio ou longo demais: erro no campo, nada gravado', async () => {
    expect(await A.responderAction(ID, { texto: '   ' })).toEqual({ ok: false, fieldErrors: { texto: 'Escreva a resposta.' } })
    expect(await A.responderAction(ID, { texto: 'x'.repeat(4097) })).toEqual({ ok: false, fieldErrors: { texto: 'A resposta passa de 4096 caracteres.' } })
    expect(responderConversa).not.toHaveBeenCalled()
  })
  it.each([
    ['fora_da_janela', JANELA],
    ['nao_e_seu', 'Só quem assumiu a conversa pode responder ou mudar o atendimento.'],
    ['transicao_invalida', 'Esta conversa mudou de situação. Confira a tela antes de continuar.'],
    ['nao_encontrada', 'Não encontramos essa conversa. Ela pode ter sido encerrada ou você não tem acesso a ela.'],
  ])('erro %s vira mensagem clara e nada é enfileirado', async (erro, msg) => {
    responderConversa.mockResolvedValue({ ok: false, erro })
    expect(await A.responderAction(ID, { texto: 'oi' })).toEqual({ ok: false, formError: msg })
    expect(enfileirar).not.toHaveBeenCalled()
  })
  it('fila fora do ar: resposta salva, avisa atraso (não pede para reenviar e duplicar)', async () => {
    responderConversa.mockResolvedValue({ ok: true, messageId: 7 })
    enfileirar.mockRejectedValue(new Error('fila'))
    expect(await A.responderAction(ID, { texto: 'oi' })).toEqual({ ok: true, data: { messageId: 7, envioAtrasado: true } })
  })
})

describe('reenviarAction', () => {
  it('volta a pendente e reenfileira a conversa', async () => {
    reenviarMensagem.mockResolvedValue({ ok: true, conversationId: ID })
    expect(await A.reenviarAction(9)).toEqual({ ok: true, data: { envioAtrasado: false } })
    expect(reenviarMensagem).toHaveBeenCalledWith('db', { sub: 'u' }, 9)
    expect(enfileirar).toHaveBeenCalledWith(ID)
  })
  it('id inválido ou erro da DAL: nada enfileirado', async () => {
    expect(await A.reenviarAction(-1)).toMatchObject({ ok: false })
    expect(reenviarMensagem).not.toHaveBeenCalled()
    reenviarMensagem.mockResolvedValue({ ok: false, erro: 'fora_da_janela' })
    expect(await A.reenviarAction(9)).toEqual({ ok: false, formError: JANELA })
    expect(enfileirar).not.toHaveBeenCalled()
  })
})

describe('devolverAction e encerrarAction', () => {
  it('devolve e encerra com os claims', async () => {
    devolverConversa.mockResolvedValue({ ok: true })
    encerrarConversa.mockResolvedValue({ ok: true })
    expect(await A.devolverAction(ID)).toEqual({ ok: true, data: null })
    expect(await A.encerrarAction(ID)).toEqual({ ok: true, data: null })
    expect(devolverConversa).toHaveBeenCalledWith('db', { sub: 'u' }, ID)
    expect(encerrarConversa).toHaveBeenCalledWith('db', { sub: 'u' }, ID)
    expect(requireStaff).toHaveBeenCalledWith(TODOS)
  })
  it('conversa de outra pessoa: mensagem clara', async () => {
    devolverConversa.mockResolvedValue({ ok: false, erro: 'nao_e_seu' })
    expect(await A.devolverAction(ID)).toEqual({ ok: false, formError: 'Só quem assumiu a conversa pode responder ou mudar o atendimento.' })
  })
})

describe('mostrarTelefoneConversaAction', () => {
  it('revela com a chave do servidor', async () => {
    revelarTelefoneConversa.mockResolvedValue({ ok: true, valor: { telefone: '+5561999990000' } })
    expect(await A.mostrarTelefoneConversaAction(ID)).toEqual({ ok: true, data: { telefone: '+5561999990000' } })
    expect(revelarTelefoneConversa).toHaveBeenCalledWith('db', { sub: 'u' }, ID, 'chave')
  })
  it('sem acesso ou simulada: indisponível', async () => {
    revelarTelefoneConversa.mockResolvedValue({ ok: false, erro: 'nao_encontrada' })
    expect(await A.mostrarTelefoneConversaAction(ID)).toEqual({ ok: false, formError: 'O telefone desta conversa não está disponível.' })
    expect(await A.mostrarTelefoneConversaAction('x')).toEqual({ ok: false, formError: 'O telefone desta conversa não está disponível.' })
  })
})
