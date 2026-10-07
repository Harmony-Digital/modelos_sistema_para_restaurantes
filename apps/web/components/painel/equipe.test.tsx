import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const criarConviteAction = vi.fn()
const reenviarConviteAction = vi.fn()
const definirAtivoAction = vi.fn()
vi.mock('@/app/(painel)/gestao/equipe/actions', () => ({ criarConviteAction, reenviarConviteAction, definirAtivoAction }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const { Equipe } = await import('./equipe')

const U1 = '00000000-0000-4000-8000-000000000001'
const integrantes = [
  { tipo: 'membro' as const, id: 'eu', nome: 'Dona', email: 'dona@x.com', papel: 'dono' as const, unidades: [], ativo: true },
  { tipo: 'membro' as const, id: 'm1', nome: 'Ana', email: 'ana@x.com', papel: 'atendente' as const, unidades: [U1], ativo: true },
  { tipo: 'membro' as const, id: 'm2', nome: 'Caio', email: 'caio@x.com', papel: 'atendente' as const, unidades: [], ativo: true, convitePendente: true, conviteId: 'cv2' },
  { tipo: 'convite' as const, id: 'c1', nome: 'Beto', email: 'beto@x.com', papel: 'gerente' as const, unidades: [], ativo: false, statusConvite: 'erro' as const },
]
const unidades = [{ id: U1, nome: 'Lago Sul' }]

describe('Equipe', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    definirAtivoAction.mockResolvedValue({ ok: true, data: null })
    reenviarConviteAction.mockResolvedValue({ ok: true, data: null })
    criarConviteAction.mockResolvedValue({ ok: true, data: { conviteId: 'c9' } })
  })

  it('gerente só vê a lista: sem convidar, reenviar nem desativar', () => {
    render(<Equipe integrantes={integrantes} unidades={unidades} meuId="g" somenteLeitura />)
    expect(screen.getByText('ana@x.com')).toBeInTheDocument()
    expect(screen.getByText('Falha ao enviar o convite')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('o dono não vê ações sobre si mesmo; vê reenviar no convite e desativar no membro', () => {
    render(<Equipe integrantes={integrantes} unidades={unidades} meuId="eu" somenteLeitura={false} />)
    expect(screen.queryByRole('button', { name: /Desativar Dona/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Desativar Ana' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reenviar convite para Beto' })).toBeInTheDocument()
    expect(screen.getByText('Lago Sul')).toBeInTheDocument()
  })

  it('reenviar chama a ação com o id do convite', async () => {
    const user = userEvent.setup()
    render(<Equipe integrantes={integrantes} unidades={unidades} meuId="eu" somenteLeitura={false} />)
    await user.click(screen.getByRole('button', { name: 'Reenviar convite para Beto' }))
    expect(reenviarConviteAction).toHaveBeenCalledWith('c1')
  })

  it('membro convidado que nunca entrou ganha Reenviar com o id do convite; quem já entrou não', async () => {
    const user = userEvent.setup()
    render(<Equipe integrantes={integrantes} unidades={unidades} meuId="eu" somenteLeitura={false} />)
    expect(screen.queryByRole('button', { name: 'Reenviar convite para Ana' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Reenviar convite para Caio' }))
    expect(reenviarConviteAction).toHaveBeenCalledWith('cv2')
  })

  it('quem já tinha conta: avisa que entra com a senha atual, sem Reenviar', () => {
    const lista = [...integrantes, {
      tipo: 'membro' as const, id: 'm3', nome: 'Duda', email: 'duda@x.com', papel: 'gerente' as const, unidades: [], ativo: true,
      convitePendente: true, conviteId: null, contaExistente: true,
    }]
    render(<Equipe integrantes={lista} unidades={unidades} meuId="eu" somenteLeitura={false} />)
    expect(screen.getByText('Já tinha conta: entra com a senha atual (nenhum e-mail enviado)')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reenviar convite para Duda' })).toBeNull()
  })

  it('desativar pede confirmação antes de chamar a ação', async () => {
    const user = userEvent.setup()
    render(<Equipe integrantes={integrantes} unidades={unidades} meuId="eu" somenteLeitura={false} />)
    await user.click(screen.getByRole('button', { name: 'Desativar Ana' }))
    expect(definirAtivoAction).not.toHaveBeenCalled()
    await user.click(await screen.findByRole('button', { name: 'Desativar' }))
    expect(definirAtivoAction).toHaveBeenCalledWith('m1', false)
  })

  it('convite com e-mail inválido não chama a ação; sem unidade escolhida também não', async () => {
    const user = userEvent.setup()
    render(<Equipe integrantes={[]} unidades={unidades} meuId="eu" somenteLeitura={false} />)
    await user.click(screen.getByRole('button', { name: /Convidar/ }))
    await user.type(await screen.findByLabelText(/^Nome/), 'Carlos')
    await user.type(screen.getByLabelText(/^E-mail/), 'sem-arroba')
    await user.click(screen.getByRole('button', { name: 'Enviar convite' }))
    expect((await screen.findAllByText('Informe um e-mail válido')).length).toBeGreaterThan(0)
    await user.clear(screen.getByLabelText(/^E-mail/))
    await user.type(screen.getByLabelText(/^E-mail/), 'c@x.com')
    await user.click(screen.getByRole('switch', { name: /Todas as unidades/ }))
    await user.click(screen.getByRole('button', { name: 'Enviar convite' }))
    expect((await screen.findAllByText('Escolha ao menos uma unidade')).length).toBeGreaterThan(0)
    expect(criarConviteAction).not.toHaveBeenCalled()
    await user.click(screen.getByRole('checkbox', { name: 'Lago Sul' }))
    await user.click(screen.getByRole('button', { name: 'Enviar convite' }))
    expect(criarConviteAction).toHaveBeenCalledWith(expect.objectContaining({ email: 'c@x.com', papel: 'atendente', todas: false, unidades: [U1] }))
  })
})
