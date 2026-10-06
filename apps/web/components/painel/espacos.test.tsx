import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const salvarEspacoAction = vi.fn()
vi.mock('@/app/(painel)/unidades/actions', () => ({ salvarEspacoAction }))
const { Espacos } = await import('./espacos')

const salao = { id: 's1', nome: 'Salão', capacidadeMin: 20, capacidadeMax: 80, descricao: null, condicoes: 'Sinal de 30%', ativo: true }

describe('Espacos', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lista nome e capacidade; estado vazio ensina', () => {
    const { rerender } = render(<Espacos unitId="u1" espacos={[salao, { ...salao, id: 's2', nome: 'Varanda', ativo: false }]} somenteLeitura={false} />)
    expect(screen.getByText('de 20 a 80 pessoas')).toBeInTheDocument()
    expect(screen.getByText(/Inativo/)).toBeInTheDocument()
    rerender(<Espacos unitId="u1" espacos={[]} somenteLeitura={false} />)
    expect(screen.getByText('Nenhum espaço cadastrado')).toBeInTheDocument()
  })

  it('atendente só lê: sem criar, editar nem desativar', () => {
    render(<Espacos unitId="u1" espacos={[salao]} somenteLeitura />)
    expect(screen.queryByRole('button', { name: 'Novo espaço' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Editar espaço/ })).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('desativar pelo switch envia o espaço inteiro com ativo falso', async () => {
    const user = userEvent.setup()
    salvarEspacoAction.mockResolvedValue({ ok: true, data: { id: 's1' } })
    render(<Espacos unitId="u1" espacos={[salao]} somenteLeitura={false} />)
    await user.click(screen.getByRole('switch', { name: 'Ativo: Salão' }))
    expect(salvarEspacoAction).toHaveBeenCalledWith('u1', 's1', {
      nome: 'Salão', capacidadeMin: '20', capacidadeMax: '80', descricao: '', condicoes: 'Sinal de 30%', ativo: false,
    })
  })

  it('novo espaço: mínimo maior que máximo não chama a ação; válido chama', async () => {
    const user = userEvent.setup()
    salvarEspacoAction.mockResolvedValue({ ok: true, data: { id: 'n' } })
    render(<Espacos unitId="u1" espacos={[]} somenteLeitura={false} />)
    await user.click(screen.getByRole('button', { name: 'Novo espaço' }))
    await user.type(await screen.findByLabelText(/^Nome do espaço/), 'Varanda')
    await user.type(screen.getByLabelText(/^Mínimo de pessoas/), '50')
    await user.type(screen.getByLabelText(/^Máximo de pessoas/), '10')
    await user.click(screen.getByRole('button', { name: 'Salvar espaço' }))
    expect((await screen.findAllByText('A capacidade mínima não pode ser maior que a máxima.')).length).toBeGreaterThan(0)
    expect(salvarEspacoAction).not.toHaveBeenCalled()
    await user.clear(screen.getByLabelText(/^Mínimo de pessoas/))
    await user.type(screen.getByLabelText(/^Mínimo de pessoas/), '5')
    await user.click(screen.getByRole('button', { name: 'Salvar espaço' }))
    expect(salvarEspacoAction).toHaveBeenCalledWith('u1', null, expect.objectContaining({ nome: 'Varanda', capacidadeMin: '5', capacidadeMax: '10' }))
  })

  it('nome repetido volta como erro do campo', async () => {
    const user = userEvent.setup()
    salvarEspacoAction.mockResolvedValue({ ok: false, fieldErrors: { nome: 'Já existe um espaço com esse nome nesta unidade.' } })
    render(<Espacos unitId="u1" espacos={[]} somenteLeitura={false} />)
    await user.click(screen.getByRole('button', { name: 'Novo espaço' }))
    await user.type(await screen.findByLabelText(/^Nome do espaço/), 'Salão')
    await user.type(screen.getByLabelText(/^Mínimo de pessoas/), '5')
    await user.type(screen.getByLabelText(/^Máximo de pessoas/), '10')
    await user.click(screen.getByRole('button', { name: 'Salvar espaço' }))
    expect((await screen.findAllByText('Já existe um espaço com esse nome nesta unidade.')).length).toBeGreaterThan(0)
  })
})
