import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

describe('FatoForm: duplo envio', () => {
  it('ação que lança vira erro geral em português', async () => {
    const user = userEvent.setup()
    const acao = vi.fn().mockRejectedValue(new Error('rede'))
    render(<FatoForm inicial={{ tema: 'Wifi', exemplos: [], texto: 'Sim, temos.', unitId: '', ativo: true }} unidades={unidades} acao={acao} rotuloSalvar="Salvar informação" />)
    await user.click(screen.getByRole('button', { name: 'Salvar informação' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível salvar. Tente de novo.')
  })

  it('dois submits seguidos chamam a ação uma vez só', async () => {
    let liberar: (v: { ok: true }) => void = () => {}
    const acao = vi.fn().mockImplementation(() => new Promise((r) => { liberar = r }))
    const { container } = render(<FatoForm inicial={{ tema: 'Wifi', exemplos: [], texto: 'Sim, temos.', unitId: '', ativo: true }} unidades={unidades} acao={acao} rotuloSalvar="Salvar informação" />)
    const form = container.querySelector('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    await waitFor(() => expect(acao).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 50))
    liberar({ ok: true })
    await waitFor(() => expect(acao).toHaveBeenCalledTimes(1))
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

  it('lacuna de espaços leva à aba Espaços da primeira unidade, ou à lista sem unidade', () => {
    const { rerender } = render(<SemResposta lacunas={[lacuna('eventos:espacos')]} unidades={unidades} somenteLeitura={false} />)
    expect(screen.getByText('Espaços de evento não cadastrados')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Cadastrar espaços' })).toHaveAttribute('href', `/unidades/${unidades[0]!.id}?aba=espacos`)
    rerender(<SemResposta lacunas={[lacuna('eventos:espacos')]} unidades={[]} somenteLeitura={false} />)
    expect(screen.getByRole('link', { name: 'Cadastrar espaços' })).toHaveAttribute('href', '/unidades')
  })

  it('sem lacunas: estado vazio que explica', () => {
    render(<SemResposta lacunas={[]} unidades={unidades} somenteLeitura={false} />)
    expect(screen.getByText('Nenhuma pergunta sem resposta')).toBeInTheDocument()
  })
})
