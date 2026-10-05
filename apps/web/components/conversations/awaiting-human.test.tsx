import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

const toast = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

import { AwaitingHuman } from './awaiting-human'

const item = { id: '11111111-1111-4111-8111-111111111111', nome: 'Maria', estado: 'aguardando_humano' as const, desde: new Date(Date.now() - 5 * 60_000) }

describe('AwaitingHuman', () => {
  it('estado vazio quando ninguém espera', () => {
    render(<AwaitingHuman itens={[]} action={vi.fn()} />)
    expect(screen.getByText('Ninguém aguardando atendente')).toBeInTheDocument()
  })
  it('devolve e confirma com toast', async () => {
    const user = userEvent.setup()
    const action = vi.fn(async () => ({ resultado: 'devolvida' as const }))
    render(<AwaitingHuman itens={[item]} action={action} />)
    expect(screen.getByText('Maria')).toBeInTheDocument()
    expect(screen.getByText(/há 5 min/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Devolver à IA a conversa de Maria' }))
    expect(action).toHaveBeenCalledWith(item.id)
    expect(toast.success).toHaveBeenCalledWith('Conversa devolvida à IA')
  })
  it('já estava com a IA: informa sem erro', async () => {
    const user = userEvent.setup()
    render(<AwaitingHuman itens={[item]} action={vi.fn(async () => ({ resultado: 'ja_estava' as const }))} />)
    await user.click(screen.getByRole('button', { name: /Devolver à IA/ }))
    expect(toast.info).toHaveBeenCalledWith('Esta conversa já estava com a IA')
  })
})
