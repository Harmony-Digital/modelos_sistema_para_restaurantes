import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Confirmar } from './confirmar'
import { DadosUnidadeForm, UNIDADE_VAZIA } from './dados-unidade-form'

describe('DadosUnidadeForm', () => {
  it('envio vazio: erro no campo certo, foco nele e resumo; não chama a ação', async () => {
    const user = userEvent.setup()
    const acao = vi.fn()
    render(<DadosUnidadeForm inicial={UNIDADE_VAZIA} acao={acao} />)
    await user.click(screen.getByRole('button', { name: 'Salvar unidade' }))
    expect(screen.getByLabelText(/^Nome da unidade/)).toHaveFocus()
    expect(screen.getAllByText(/Informe o nome da unidade, como "Asa Sul"/).length).toBeGreaterThan(0)
    expect(screen.getByRole('region', { name: 'Corrija 1 campo' })).toBeInTheDocument()
    expect(acao).not.toHaveBeenCalled()
  })

  it('erro do servidor aparece no campo; link do Maps reconhecido ganha confirmação', async () => {
    const user = userEvent.setup()
    const acao = vi.fn().mockResolvedValue({ ok: false, fieldErrors: { nome: 'Já existe uma unidade com esse nome.' } })
    render(<DadosUnidadeForm inicial={UNIDADE_VAZIA} acao={acao} />)
    await user.type(screen.getByLabelText(/^Nome da unidade/), 'Asa Sul')
    await user.type(screen.getByLabelText(/^Link do Google Maps/), 'https://maps.app.goo.gl/Ab12')
    expect(screen.getByText('Link do Google Maps reconhecido')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Salvar unidade' }))
    expect(await screen.findByText('Já existe uma unidade com esse nome.')).toBeInTheDocument()
    expect(acao).toHaveBeenCalledWith(expect.objectContaining({ nome: 'Asa Sul', mapsUrl: 'https://maps.app.goo.gl/Ab12' }))
  })

  it('somente leitura: campos desabilitados e sem botão de salvar', () => {
    render(<DadosUnidadeForm inicial={{ ...UNIDADE_VAZIA, nome: 'Asa Sul' }} acao={vi.fn()} somenteLeitura />)
    expect(screen.getByLabelText(/^Nome da unidade/)).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Salvar unidade' })).toBeNull()
  })
})

describe('Confirmar', () => {
  it('só apaga depois de confirmar', async () => {
    const user = userEvent.setup()
    const onConfirmar = vi.fn()
    const onAbertoChange = vi.fn()
    render(<Confirmar aberto onAbertoChange={onAbertoChange} titulo="Apagar exceção?" descricao="Não dá para desfazer." rotuloConfirmar="Apagar" onConfirmar={onConfirmar} />)
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onConfirmar).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Apagar' }))
    expect(onConfirmar).toHaveBeenCalledOnce()
  })
})
