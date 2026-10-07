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

  it('ação que lança vira erro geral em português', async () => {
    const user = userEvent.setup()
    const acao = vi.fn().mockRejectedValue(new Error('rede'))
    render(<DadosUnidadeForm inicial={UNIDADE_VAZIA} acao={acao} />)
    await user.type(screen.getByLabelText(/^Nome da unidade/), 'Asa Sul')
    await user.click(screen.getByRole('button', { name: 'Salvar unidade' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível salvar. Tente de novo.')
  })

  it('duas na mesma tela (unidade aberta + folha "Nova unidade"): ids próprios, cada rótulo no seu campo e resumo apontando certo', async () => {
    const user = userEvent.setup()
    render(
      <>
        <section aria-label="Aberta"><DadosUnidadeForm inicial={{ ...UNIDADE_VAZIA, nome: 'Asa Sul' }} acao={vi.fn()} /></section>
        <section aria-label="Nova"><DadosUnidadeForm idPrefixo="nova-" inicial={UNIDADE_VAZIA} acao={vi.fn()} /></section>
      </>,
    )
    const nova = screen.getByRole('region', { name: 'Nova' })
    const campos = screen.getAllByLabelText(/^Nome da unidade/)
    expect(campos).toHaveLength(2)
    expect(new Set(campos.map((c) => c.id)).size).toBe(2)
    expect(nova.querySelector('#nova-nome')).toBe(campos[1])
    await user.click(nova.querySelector('button[type="submit"]')!)
    expect(campos[1]).toHaveFocus()
    expect(nova.querySelector('a[href="#nova-nome"]')).not.toBeNull()
  })

  it('lotação máxima (pessoas por dia): vazia vai como sem limite; número vai inteiro; inválida mostra o erro e não envia', async () => {
    const user = userEvent.setup()
    const acao = vi.fn().mockResolvedValue({ ok: true, data: { id: 'u1' } })
    render(<DadosUnidadeForm inicial={{ ...UNIDADE_VAZIA, nome: 'Asa Sul' }} acao={acao} />)
    const campo = screen.getByLabelText(/^Lotação máxima \(pessoas por dia\)/)
    expect(campo).toHaveAttribute('inputmode', 'numeric')
    await user.click(screen.getByRole('button', { name: 'Salvar unidade' }))
    expect(acao).toHaveBeenLastCalledWith(expect.objectContaining({ capacidadePessoas: null }))
    await user.type(campo, '9000')
    await user.click(screen.getByRole('button', { name: 'Salvar unidade' }))
    expect((await screen.findAllByText('Informe de 1 a 5000 pessoas, ou deixe em branco para não limitar.')).length).toBeGreaterThan(0)
    expect(acao).toHaveBeenCalledTimes(1)
    await user.clear(campo)
    await user.type(campo, '150')
    await user.click(screen.getByRole('button', { name: 'Salvar unidade' }))
    await vi.waitFor(() => expect(acao).toHaveBeenLastCalledWith(expect.objectContaining({ capacidadePessoas: 150 })))
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
  it('mostra o rótulo de andamento escolhido enquanto executa', async () => {
    const user = userEvent.setup()
    let liberar!: () => void
    const onConfirmar = vi.fn(() => new Promise<void>((r) => { liberar = r }))
    render(<Confirmar aberto onAbertoChange={vi.fn()} titulo="Voltar ao padrão?" descricao="x" rotuloConfirmar="Restaurar" rotuloAndamento="Restaurando…" onConfirmar={onConfirmar} />)
    await user.click(screen.getByRole('button', { name: 'Restaurar' }))
    expect(screen.getByRole('button', { name: 'Restaurando…' })).toBeDisabled()
    liberar()
    expect(await screen.findByRole('button', { name: 'Restaurar' })).toBeEnabled()
  })
})
