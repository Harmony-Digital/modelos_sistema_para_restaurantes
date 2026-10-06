import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const salvarRespostaRapidaAction = vi.fn()
vi.mock('@/app/(painel)/mais/atendimento-humano/actions', () => ({ salvarRespostaRapidaAction }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const { RespostasRapidas } = await import('./respostas-rapidas')

const oi = { id: 'r1', titulo: 'Boas-vindas', texto: 'Olá! Já vamos atender.', ativo: true }

describe('RespostasRapidas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    salvarRespostaRapidaAction.mockResolvedValue({ ok: true, data: { id: 'r1' } })
  })

  it('lista com contagem de ativas; estado vazio ensina', () => {
    const { rerender } = render(<RespostasRapidas respostas={[oi, { ...oi, id: 'r2', titulo: 'Fechado', ativo: false }]} somenteLeitura={false} />)
    expect(screen.getByText(/1 de 30 ativas/)).toBeInTheDocument()
    expect(screen.getByText(/Inativa/)).toBeInTheDocument()
    rerender(<RespostasRapidas respostas={[]} somenteLeitura={false} />)
    expect(screen.getByText('Nenhuma resposta rápida')).toBeInTheDocument()
  })

  it('atendente só consulta: sem criar, editar nem desativar', () => {
    render(<RespostasRapidas respostas={[oi]} somenteLeitura />)
    expect(screen.getByText('Olá! Já vamos atender.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nova resposta' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Editar resposta/ })).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('desativar pelo switch envia a resposta com ativo falso', async () => {
    const user = userEvent.setup()
    render(<RespostasRapidas respostas={[oi]} somenteLeitura={false} />)
    await user.click(screen.getByRole('switch', { name: 'Ativa: Boas-vindas' }))
    expect(salvarRespostaRapidaAction).toHaveBeenCalledWith('r1', { titulo: 'Boas-vindas', texto: 'Olá! Já vamos atender.', ativo: false })
  })

  it('nova resposta: sem título não chama a ação; válida chama e mostra o erro de limite do servidor', async () => {
    const user = userEvent.setup()
    render(<RespostasRapidas respostas={[]} somenteLeitura={false} />)
    await user.click(screen.getByRole('button', { name: 'Nova resposta' }))
    await user.type(await screen.findByLabelText(/^Texto/), 'Olá')
    await user.click(screen.getByRole('button', { name: 'Salvar resposta' }))
    expect((await screen.findAllByText('Dê um título curto, como "Boas-vindas"')).length).toBeGreaterThan(0)
    expect(salvarRespostaRapidaAction).not.toHaveBeenCalled()
    salvarRespostaRapidaAction.mockResolvedValue({ ok: false, formError: 'Você já tem 30 respostas rápidas ativas. Desative uma para ativar outra.' })
    await user.type(screen.getByLabelText(/^Título/), 'Oi')
    await user.click(screen.getByRole('button', { name: 'Salvar resposta' }))
    expect(salvarRespostaRapidaAction).toHaveBeenCalledWith(null, { titulo: 'Oi', texto: 'Olá', ativo: true })
    expect(await screen.findByText(/Você já tem 30 respostas rápidas ativas/)).toBeInTheDocument()
  })
})
