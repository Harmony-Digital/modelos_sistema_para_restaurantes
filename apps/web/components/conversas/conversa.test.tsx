import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const toast = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

import { Conversa, type AcoesConversa, type ConversaTela } from './conversa'
import type { MensagemTelaInbox } from './bolha'

const ID = '11111111-1111-4111-8111-111111111111'
const agora = new Date('2026-10-06T12:00:00Z')
const base: ConversaTela = {
  id: ID, nome: 'Maria', unidade: 'Asa Sul', estado: 'aguardando_humano', atendente: null, atendenteId: null,
  janelaAte: new Date('2026-10-07T10:00:00Z'), simulada: false, handoffMotivo: 'pedido',
}
const falhou: MensagemTelaInbox = {
  id: 5, direcao: 'out', autor: 'humano', atendente: 'Ana', tipo: 'texto', texto: 'Oi', transcrito: false, payload: null,
  statusEnvio: 'falhou:131047', createdAt: new Date('2026-10-06T11:00:00Z'),
}
const ok = async () => ({ ok: true as const, data: null })
let acoes: { [K in keyof AcoesConversa]: ReturnType<typeof vi.fn> }

function montar(c: Partial<ConversaTela> = {}, extra: { papel?: 'dono' | 'gerente' | 'atendente'; mensagens?: MensagemTelaInbox[] } = {}) {
  return render(
    <Conversa
      conversa={{ ...base, ...c }}
      mensagens={extra.mensagens ?? []}
      meuId="eu"
      papel={extra.papel ?? 'atendente'}
      timezone="America/Sao_Paulo"
      agora={agora}
      respostasRapidas={[]}
      maisAntigas={null}
      acoes={acoes as unknown as AcoesConversa}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  acoes = {
    assumir: vi.fn(ok), responder: vi.fn(), reenviar: vi.fn(async () => ({ ok: true as const, data: { envioAtrasado: false } })),
    devolver: vi.fn(ok), encerrar: vi.fn(ok), mostrarTelefone: vi.fn(async () => ({ ok: true as const, data: { telefone: '+5561999990000' } })),
  }
})

describe('Conversa', () => {
  it('aguardando: Assumir chama a action; sem compositor até assumir', async () => {
    montar()
    expect(screen.queryByRole('textbox', { name: 'Resposta' })).toBeNull()
    expect(screen.getByText('Assuma a conversa para responder o cliente.')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Assumir' }))
    expect(acoes.assumir).toHaveBeenCalledWith(ID, { forcar: false })
    expect(toast.success).toHaveBeenCalledWith('Conversa assumida. Agora é com você.')
  })

  it('humano sem atendente (usuário removido): livre para assumir sem "mesmo assim"', async () => {
    montar({ estado: 'humano', atendente: null, atendenteId: null })
    expect(screen.queryByText(/está atendendo esta conversa/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Assumir mesmo assim' })).toBeNull()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Assumir' }))
    expect(acoes.assumir).toHaveBeenCalledWith(ID, { forcar: false })
    expect(screen.getByRole('button', { name: 'Devolver à IA' })).toBeInTheDocument()
  })

  it('assumir perdido na corrida: mostra quem está atendendo', async () => {
    acoes.assumir.mockResolvedValue({ ok: false, formError: 'Bia já está atendendo esta conversa.' })
    montar()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Assumir' }))
    expect(toast.error).toHaveBeenCalledWith('Bia já está atendendo esta conversa.')
  })

  it('comigo: compositor aberto, Devolver à IA e Encerrar (com confirmação)', async () => {
    const user = userEvent.setup()
    montar({ estado: 'humano', atendente: 'Ana', atendenteId: 'eu' })
    expect(screen.getByRole('textbox', { name: 'Resposta' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Assumir' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Devolver à IA' }))
    expect(acoes.devolver).toHaveBeenCalledWith(ID)
    await user.click(screen.getByRole('button', { name: 'Encerrar' }))
    expect(acoes.encerrar).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Encerrar conversa' }))
    expect(acoes.encerrar).toHaveBeenCalledWith(ID)
  })

  it('comigo e fora da janela: compositor desabilitado', () => {
    montar({ estado: 'humano', atendente: 'Ana', atendenteId: 'eu', janelaAte: new Date('2026-10-06T11:00:00Z') })
    expect(screen.getByRole('textbox', { name: 'Resposta' })).toBeDisabled()
  })

  it('com outra pessoa: atendente só vê quem atende; gerente pode assumir mesmo assim, com confirmação', async () => {
    const user = userEvent.setup()
    const { unmount } = montar({ estado: 'humano', atendente: 'Bia', atendenteId: 'bia' })
    expect(screen.getByText('Bia está atendendo esta conversa.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Assumir/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Devolver à IA' })).toBeNull()
    unmount()
    montar({ estado: 'humano', atendente: 'Bia', atendenteId: 'bia' }, { papel: 'gerente' })
    await user.click(screen.getByRole('button', { name: 'Assumir mesmo assim' }))
    expect(acoes.assumir).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toHaveTextContent('Bia')
    await user.click(screen.getByRole('button', { name: 'Assumir conversa' }))
    expect(acoes.assumir).toHaveBeenCalledWith(ID, { forcar: true })
  })

  it('encerrada: sem ações de atendimento', () => {
    montar({ estado: 'encerrada' })
    for (const nome of ['Assumir', 'Devolver à IA', 'Encerrar']) expect(screen.queryByRole('button', { name: nome })).toBeNull()
  })

  it('"Tentar de novo" só para quem atende, chamando reenviar', async () => {
    montar({ estado: 'humano', atendente: 'Ana', atendenteId: 'eu' }, { mensagens: [falhou] })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(acoes.reenviar).toHaveBeenCalledWith(5)
  })

  it('telefone sob demanda (simulação não tem)', async () => {
    const { unmount } = montar()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Mostrar telefone' }))
    expect(acoes.mostrarTelefone).toHaveBeenCalledWith(ID)
    expect(screen.getByText('+5561999990000')).toBeInTheDocument()
    unmount()
    montar({ simulada: true })
    expect(screen.queryByRole('button', { name: 'Mostrar telefone' })).toBeNull()
    expect(screen.getByText('Simulação')).toBeInTheDocument()
  })
})
