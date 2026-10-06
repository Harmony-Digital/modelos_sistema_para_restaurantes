import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireStaff = vi.fn()
const resumoAcessoTitular = vi.fn()
const revelarTelefoneTitular = vi.fn()
const concluirAcesso = vi.fn()
const executarExclusao = vi.fn()
const negarPedido = vi.fn()
const salvarRetencao = vi.fn()
const revalidatePath = vi.fn()
vi.mock('@/lib/dal', () => ({ requireStaff }))
vi.mock('@/lib/server/db', () => ({ getDb: () => 'db' }))
vi.mock('@/lib/server/env', () => ({ env: () => ({ phoneKey: 'chave' }) }))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@atd/db', () => ({
  resumoAcessoTitular, revelarTelefoneTitular, concluirAcesso, executarExclusao, negarPedido, salvarRetencao,
}))

const {
  gerarResumoAction, revelarTelefoneTitularAction, concluirAcessoAction, excluirTitularAction, negarPedidoAction, salvarRetencaoAction,
} = await import('./actions')

const ID = '00000000-0000-4000-8000-0000000000aa'
const GESTAO = ['dono', 'gerente']
const INDISPONIVEL = { ok: false, formError: 'Esse pedido não está mais disponível.' }

beforeEach(() => {
  vi.clearAllMocks()
  requireStaff.mockResolvedValue({ claims: { sub: 'u' }, role: 'dono' })
  concluirAcesso.mockResolvedValue({ ok: true, valor: null })
  executarExclusao.mockResolvedValue({ ok: true, valor: { contagens: { mensagens: 3, conversas: 1, avisos: 0, eventos: 1 } } })
  negarPedido.mockResolvedValue({ ok: true, valor: null })
  salvarRetencao.mockResolvedValue({ ok: true, valor: null })
})

describe('papéis', () => {
  it('fila: dono e gerente (atendente é redirecionado antes do banco)', async () => {
    requireStaff.mockRejectedValue(new Error('NEXT_REDIRECT'))
    await expect(gerarResumoAction(ID)).rejects.toThrow()
    await expect(revelarTelefoneTitularAction(ID)).rejects.toThrow()
    await expect(concluirAcessoAction(ID)).rejects.toThrow()
    await expect(excluirTitularAction(ID, 'EXCLUIR')).rejects.toThrow()
    await expect(negarPedidoAction(ID, { resposta: 'x' })).rejects.toThrow()
    for (const c of requireStaff.mock.calls) expect(c[0]).toEqual(GESTAO)
    expect(executarExclusao).not.toHaveBeenCalled()
    expect(resumoAcessoTitular).not.toHaveBeenCalled()
  })

  it('prazos de retenção: só o dono', async () => {
    requireStaff.mockRejectedValue(new Error('NEXT_REDIRECT'))
    await expect(salvarRetencaoAction({ dado: 'messages', dias: 90 })).rejects.toThrow()
    expect(requireStaff).toHaveBeenCalledWith(['dono'])
    expect(salvarRetencao).not.toHaveBeenCalled()
  })
})

describe('resumo de acesso e telefone', () => {
  it('gera o resumo pela DAL (auditado lá)', async () => {
    resumoAcessoTitular.mockResolvedValue({ pedidoId: ID, nomePerfil: 'Ana' })
    expect(await gerarResumoAction(ID)).toEqual({ ok: true, data: { pedidoId: ID, nomePerfil: 'Ana' } })
    expect(resumoAcessoTitular).toHaveBeenCalledWith('db', { sub: 'u' }, ID)
  })

  it('cliente apagado ou pedido invisível ⇒ mensagem, sem dado', async () => {
    resumoAcessoTitular.mockResolvedValue(null)
    expect(await gerarResumoAction(ID)).toEqual({ ok: false, formError: 'Não há dados desse cliente para resumir. Ele pode já ter sido excluído.' })
  })

  it('id inválido não chega ao banco', async () => {
    expect(await gerarResumoAction('x')).toEqual(INDISPONIVEL)
    expect(await revelarTelefoneTitularAction('x')).toEqual(INDISPONIVEL)
    expect(await excluirTitularAction('x', 'EXCLUIR')).toEqual(INDISPONIVEL)
    expect(resumoAcessoTitular).not.toHaveBeenCalled()
    expect(revelarTelefoneTitular).not.toHaveBeenCalled()
    expect(executarExclusao).not.toHaveBeenCalled()
  })

  it('telefone só sob pedido, com a chave do servidor', async () => {
    revelarTelefoneTitular.mockResolvedValue({ ok: true, valor: { telefone: '+5561999990000' } })
    expect(await revelarTelefoneTitularAction(ID)).toEqual({ ok: true, data: { telefone: '+5561999990000' } })
    expect(revelarTelefoneTitular).toHaveBeenCalledWith('db', { sub: 'u' }, ID, 'chave')
    revelarTelefoneTitular.mockResolvedValue({ ok: false, erro: 'nao_encontrada' })
    expect(await revelarTelefoneTitularAction(ID)).toEqual(INDISPONIVEL)
  })

  it('concluir acesso revalida a fila e o Início; pedido já resolvido vira aviso', async () => {
    expect(await concluirAcessoAction(ID)).toEqual({ ok: true, data: null })
    expect(revalidatePath).toHaveBeenCalledWith('/mais/privacidade')
    expect(revalidatePath).toHaveBeenCalledWith('/')
    concluirAcesso.mockResolvedValue({ ok: false, erro: 'transicao_invalida' })
    expect(await concluirAcessoAction(ID)).toEqual({ ok: false, formError: 'Esse pedido já foi resolvido ou não aceita essa ação.' })
  })
})

describe('exclusão confirmada', () => {
  it('sem digitar EXCLUIR não exclui', async () => {
    expect(await excluirTitularAction(ID, 'excluir já')).toEqual({ ok: false, fieldErrors: { confirmacao: 'Digite EXCLUIR para confirmar.' } })
    expect(await excluirTitularAction(ID, '')).toMatchObject({ ok: false })
    expect(executarExclusao).not.toHaveBeenCalled()
  })

  it('aceita maiúsculas/minúsculas e espaços nas pontas; devolve as contagens', async () => {
    const r = await excluirTitularAction(ID, '  excluir ')
    expect(r).toEqual({ ok: true, data: { contagens: { mensagens: 3, conversas: 1, avisos: 0, eventos: 1 } } })
    expect(executarExclusao).toHaveBeenCalledWith('db', { sub: 'u' }, ID)
    expect(revalidatePath).toHaveBeenCalledWith('/mais/privacidade')
    expect(revalidatePath).toHaveBeenCalledWith('/conversas')
    expect(revalidatePath).toHaveBeenCalledWith('/agenda')
  })

  it('gerente também exclui', async () => {
    requireStaff.mockResolvedValue({ claims: { sub: 'g' }, role: 'gerente' })
    expect((await excluirTitularAction(ID, 'EXCLUIR')).ok).toBe(true)
  })

  it('pedido já resolvido ⇒ aviso, sem revalidar', async () => {
    executarExclusao.mockResolvedValue({ ok: false, erro: 'transicao_invalida' })
    expect(await excluirTitularAction(ID, 'EXCLUIR')).toEqual({ ok: false, formError: 'Esse pedido já foi resolvido ou não aceita essa ação.' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe('negar', () => {
  it('resposta obrigatória, até 300 caracteres', async () => {
    expect(await negarPedidoAction(ID, { resposta: '   ' })).toMatchObject({ ok: false, fieldErrors: { resposta: expect.any(String) } })
    expect(await negarPedidoAction(ID, { resposta: 'x'.repeat(301) })).toMatchObject({ ok: false, fieldErrors: { resposta: 'Use no máximo 300 caracteres' } })
    expect(negarPedido).not.toHaveBeenCalled()
  })

  it('grava a resposta aparada', async () => {
    expect(await negarPedidoAction(ID, { resposta: ' Pedido duplicado. ' })).toEqual({ ok: true, data: null })
    expect(negarPedido).toHaveBeenCalledWith('db', { sub: 'u' }, ID, 'Pedido duplicado.')
  })
})

describe('prazos de retenção', () => {
  it('respeita o mínimo por dado antes do banco', async () => {
    expect(await salvarRetencaoAction({ dado: 'messages', dias: 6 })).toEqual({ ok: false, fieldErrors: { dias: 'O mínimo é 7 dias.' } })
    expect(await salvarRetencaoAction({ dado: 'ai_runs', dias: 29 })).toEqual({ ok: false, fieldErrors: { dias: 'O mínimo é 30 dias.' } })
    expect(await salvarRetencaoAction({ dado: 'ai_runs', dias: 3651 })).toEqual({ ok: false, fieldErrors: { dias: 'O máximo é 3650 dias (10 anos).' } })
    expect(await salvarRetencaoAction({ dado: 'ai_runs', dias: 30.5 })).toMatchObject({ ok: false, fieldErrors: { dias: expect.any(String) } })
    expect(await salvarRetencaoAction({ dado: 'audio' as never, dias: 30 })).toMatchObject({ ok: false })
    expect(salvarRetencao).not.toHaveBeenCalled()
  })

  it('válido: grava e revalida', async () => {
    expect(await salvarRetencaoAction({ dado: 'messages', dias: 7 })).toEqual({ ok: true, data: null })
    expect(salvarRetencao).toHaveBeenCalledWith('db', { sub: 'u' }, { dado: 'messages', dias: 7 })
    expect(revalidatePath).toHaveBeenCalledWith('/mais/privacidade')
  })

  it('sem permissão no banco vira mensagem', async () => {
    salvarRetencao.mockResolvedValue({ ok: false, erro: 'sem_permissao' })
    expect(await salvarRetencaoAction({ dado: 'messages', dias: 30 })).toEqual({ ok: false, formError: 'Você não tem permissão para fazer essa alteração.' })
  })
})
