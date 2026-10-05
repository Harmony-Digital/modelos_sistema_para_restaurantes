import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatCard } from './stat-card'

describe('StatCard', () => {
  it('expõe rótulo e valor juntos para leitor de tela', () => {
    render(<StatCard label="Conversas abertas" value="12" hint="3 aguardando atendente" />)
    expect(screen.getByRole('group', { name: 'Conversas abertas: 12' })).toBeInTheDocument()
    expect(screen.getByText('3 aguardando atendente')).toBeInTheDocument()
  })
  it('estado de alerta não depende só de cor', () => {
    render(<StatCard label="IA" value="Offline" tone="alerta" />)
    expect(screen.getByText('Offline')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'IA: Offline' }).querySelector('[data-tone="alerta"] svg')).not.toBeNull()
  })
  it('valor longo quebra dentro do cartão em vez de vazar (celular)', () => {
    render(<StatCard label="Conversas abertas" value="1234567890" />)
    const valor = screen.getByText('1234567890')
    expect(valor.className).toMatch(/break-all|break-words|wrap-anywhere/)
    expect(screen.getByRole('group').className).toMatch(/min-w-0/)
  })
})
