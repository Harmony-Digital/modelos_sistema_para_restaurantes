import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

const toast = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

import { AwaitingHuman } from './awaiting-human'

const item = { id: '11111111-1111-4111-8111-111111111111', nome: 'Maria', estado: 'aguardando_humano' as const, desde: new Date(Date.now() - 5 * 60_000) }

describe('AwaitingHuman', () => {
  it('estado vazio quando ninguém espera, com link para a inbox', () => {
    render(<AwaitingHuman itens={[]} action={vi.fn()} />)
    expect(screen.getByText('Ninguém aguardando atendente')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Abrir conversas' })).toHaveAttribute('href', '/conversas')
  })
  it('item leva à conversa', () => {
    render(<AwaitingHuman itens={[item]} action={vi.fn()} />)
    expect(screen.getByRole('link', { name: /Maria/ })).toHaveAttribute('href', `/conversas/${item.id}`)
  })
  it('devolve e confirma com toast', async () => {
    const user = userEvent.setup()
    const action = vi.fn(async () => ({ ok: true as const, data: null }))
    render(<AwaitingHuman itens={[item]} action={action} />)
    expect(screen.getByText('Maria')).toBeInTheDocument()
    expect(screen.getByText(/há 5 min/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Devolver à IA a conversa de Maria' }))
    expect(action).toHaveBeenCalledWith(item.id)
    expect(toast.success).toHaveBeenCalledWith('Conversa devolvida à IA')
  })
  it('erro da action: toast com a mensagem dela', async () => {
    const user = userEvent.setup()
    render(<AwaitingHuman itens={[item]} action={vi.fn(async () => ({ ok: false as const, formError: 'Esta conversa mudou de situação.' }))} />)
    await user.click(screen.getByRole('button', { name: /Devolver à IA/ }))
    expect(toast.error).toHaveBeenCalledWith('Esta conversa mudou de situação.')
  })
  it('ação lança: toast de erro e botão volta a ficar ativo', async () => {
    const user = userEvent.setup()
    render(<AwaitingHuman itens={[item]} action={vi.fn(async () => { throw new Error('boom') })} />)
    await user.click(screen.getByRole('button', { name: /Devolver à IA/ }))
    expect(toast.error).toHaveBeenCalledWith('Não foi possível salvar. Tente de novo.')
    // o toast sai antes do finally que reabilita o botão: sob carga o render seguinte ainda não aconteceu
    await waitFor(() => expect(screen.getByRole('button', { name: /Devolver à IA/ })).toBeEnabled())
  })
})
