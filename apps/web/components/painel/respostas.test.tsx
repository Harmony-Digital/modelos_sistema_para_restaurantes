import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/app/(painel)/respostas/actions', () => ({
  responderLacunaAction: vi.fn(), ignorarLacunaAction: vi.fn(), salvarFatoAction: vi.fn(), removerFatoAction: vi.fn(),
}))
const { FatoForm } = await import('./fato-form')
const { SemResposta } = await import('./sem-resposta')

const unidades = [{ id: '00000000-0000-4000-8000-000000000001', nome: 'Asa Sul' }]
const lacuna = (chave: string, unitId: string | null = null) => ({
  id: crypto.randomUUID(), chave, unitId, unidade: unitId ? 'Asa Sul' : null, pergunta: 'tem área kids?', ocorrencias: 4, ultimaVez: '2026-10-05T17:00:00.000Z',
})

describe('FatoForm', () => {
  it('mensagens exatas e envio com unidade "todas" como vazio', async () => {
    const user = userEvent.setup()
    const acao = vi.fn().mockResolvedValue({ ok: true, data: { id: 'x' } })
    render(<FatoForm inicial={{ tema: '', exemplos: [], texto: '', unitId: '', ativo: true }} unidades={unidades} acao={acao} rotuloSalvar="Salvar informação" />)
    await user.click(screen.getByRole('button', { name: 'Salvar informação' }))
    expect(screen.getByLabelText(/^Assunto/)).toHaveFocus()
    expect(screen.getAllByText('Escreva a resposta que a IA deve enviar').length).toBeGreaterThan(0)
    await user.type(screen.getByLabelText(/^Assunto/), 'Estacionamento')
    await user.type(screen.getByLabelText(/^Resposta/), 'Temos estacionamento gratuito.')
    await user.click(screen.getByRole('button', { name: 'Salvar informação' }))
    expect(acao).toHaveBeenCalledWith({ tema: 'Estacionamento', exemplos: [], texto: 'Temos estacionamento gratuito.', unitId: '', ativo: true })
  })
})

describe('SemResposta', () => {
  it('lacuna de informação abre o formulário pré-preenchido; de horário leva à unidade', async () => {
    const user = userEvent.setup()
    render(<SemResposta lacunas={[lacuna('info:area kids'), lacuna('horario', unidades[0]!.id)]} unidades={unidades} somenteLeitura={false} />)
    expect(screen.getAllByText('4 vezes')).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'Cadastrar horários da Asa Sul' })).toHaveAttribute('href', `/unidades/${unidades[0]!.id}?aba=horarios`)
    await user.click(screen.getByRole('button', { name: 'Responder: Area kids' }))
    expect(await screen.findByLabelText(/^Assunto/)).toHaveValue('Area kids')
    expect(screen.getByText('tem área kids?', { selector: 'li' })).toBeInTheDocument()
  })

  it('sem lacunas: estado vazio que explica', () => {
    render(<SemResposta lacunas={[]} unidades={unidades} somenteLeitura={false} />)
    expect(screen.getByText('Nenhuma pergunta sem resposta')).toBeInTheDocument()
  })
})
