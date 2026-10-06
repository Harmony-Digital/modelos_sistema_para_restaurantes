import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

const salvarModeloAction = vi.fn()
vi.mock('@/app/(painel)/conteudo/actions', () => ({ salvarModeloAction, restaurarModeloAction: vi.fn() }))
const { Modelos } = await import('./modelos')

const unidade = { nome: 'Lago Sul', endereco: 'SHIS QI 11 Bloco A', bairro: 'Lago Sul', cidade: 'Brasília', uf: 'DF', mapsUrl: null }

describe('Modelos', () => {
  it('mostra prévia real, marca personalizado e valida ao editar', async () => {
    const user = userEvent.setup()
    render(<Modelos personalizados={{ lacuna: 'Vou confirmar com a equipe.' }} unidade={unidade} somenteLeitura={false} />)
    const item = screen.getByRole('listitem', { name: 'Ainda não sabe responder' })
    expect(within(item).getByText('Personalizado')).toBeInTheDocument()
    expect(within(item).getByText('Vou confirmar com a equipe.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Editar: Horário de um dia' }))
    const campo = await screen.findByLabelText(/^Texto/)
    await user.clear(campo)
    await user.type(campo, '{{quando}, abrimos.')
    expect(screen.getByText('Domingo (11/10), abrimos.')).toBeInTheDocument() // prévia ao vivo
    await user.click(screen.getByRole('button', { name: 'Salvar modelo' }))
    expect(await screen.findByText('Inclua {turnos} no texto: é ali que entra a informação.')).toBeInTheDocument()
    expect(salvarModeloAction).not.toHaveBeenCalled()
  })

  it('ação que lança vira erro geral em português', async () => {
    const user = userEvent.setup()
    salvarModeloAction.mockRejectedValueOnce(new Error('rede'))
    render(<Modelos personalizados={{}} unidade={unidade} somenteLeitura={false} />)
    await user.click(screen.getByRole('button', { name: 'Editar: Ainda não sabe responder' }))
    await user.click(await screen.findByRole('button', { name: 'Salvar modelo' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível salvar. Tente de novo.')
  })
})
