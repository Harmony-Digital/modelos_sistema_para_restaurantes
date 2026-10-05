import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ExcecaoForm } from './excecao-form'
import { ExcecoesUnidade } from './excecoes-unidade'

vi.mock('@/app/(painel)/unidades/actions', () => ({ salvarExcecaoAction: vi.fn(), removerExcecaoAction: vi.fn() }))

describe('ExcecaoForm', () => {
  it('data inválida avisa; aberta sem turno pede turno; fechado esconde os turnos', async () => {
    const user = userEvent.setup()
    const acao = vi.fn().mockResolvedValue({ ok: true, data: null })
    render(<ExcecaoForm inicial={{ data: '', fechado: false, turnos: [], motivo: '' }} acao={acao} />)
    await user.type(screen.getByLabelText(/^Data/), '31022026')
    await user.click(screen.getByRole('button', { name: 'Salvar exceção' }))
    expect(await screen.findByText('Data inexistente. Use dd/mm/aaaa, como 12/10/2026')).toBeInTheDocument()
    expect(acao).not.toHaveBeenCalled()

    // a regra do formulário inteiro (turno obrigatório) só roda com os campos válidos
    await user.clear(screen.getByLabelText(/^Data/))
    await user.type(screen.getByLabelText(/^Data/), '24122026')
    await user.click(screen.getByRole('button', { name: 'Salvar exceção' }))
    expect(await screen.findByText('Adicione pelo menos um turno ou marque "Fechado o dia todo".')).toBeInTheDocument()
    expect(acao).not.toHaveBeenCalled()

    await user.click(screen.getByRole('switch', { name: 'Fechado o dia todo' }))
    expect(screen.queryByRole('button', { name: 'Adicionar turno' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Salvar exceção' }))
    expect(acao).toHaveBeenCalledWith({ data: '24/12/2026', fechado: true, turnos: [], motivo: '' })
  })

  it('ao editar, a data fica somente leitura e explica como mudar', async () => {
    const user = userEvent.setup()
    const acao = vi.fn().mockResolvedValue({ ok: true, data: null })
    render(<ExcecaoForm inicial={{ data: '24/12/2026', fechado: true, turnos: [], motivo: '' }} acao={acao} dataFixa />)
    const data = screen.getByLabelText(/^Data/)
    expect(data).toHaveAttribute('readonly')
    expect(screen.getByText('Para mudar a data, apague e crie outra.')).toBeInTheDocument()
    await user.type(data, '25122026')
    expect(data).toHaveValue('24/12/2026')
    await user.click(screen.getByRole('button', { name: 'Salvar exceção' }))
    expect(acao).toHaveBeenCalledWith({ data: '24/12/2026', fechado: true, turnos: [], motivo: '' })
  })

  it('na lista, editar trava a data e nova exceção deixa escolher', async () => {
    const user = userEvent.setup()
    const dia = { data: '2026-12-24' as const, dataBr: '24/12/2026', rotulo: 'Quinta, 24/12/2026', feriado: null, comportamento: 'Fechado', temExcecao: true, motivo: null }
    render(
      <ExcecoesUnidade
        unitId="u"
        somenteLeitura={false}
        feriados={[]}
        excecoes={[{ ...dia, inicial: { data: '24/12/2026', fechado: true, turnos: [], motivo: '' } }]}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Editar exceção de 24/12/2026' }))
    expect(await screen.findByRole('textbox', { name: /^Data/ })).toHaveAttribute('readonly')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('textbox', { name: /^Data/ })).toBeNull())
    await user.click(screen.getByRole('button', { name: 'Nova exceção' }))
    expect(await screen.findByRole('textbox', { name: /^Data/ })).not.toHaveAttribute('readonly')
  })
})
