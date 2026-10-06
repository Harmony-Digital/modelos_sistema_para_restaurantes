import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const pathname = vi.hoisted(() => ({ value: '/' }))
vi.mock('next/navigation', () => ({ usePathname: () => pathname.value }))

import { BottomNav } from './bottom-nav'

describe('BottomNav', () => {
  beforeEach(() => {
    pathname.value = '/'
  })
  it('mostra os 5 destinos com rótulo, na ordem: Conversas entra, Unidades vai para Mais', () => {
    render(<BottomNav />)
    for (const nome of ['Início', 'Conversas', 'Agenda', 'Conteúdo', 'Mais']) {
      expect(screen.getByRole('link', { name: nome })).toBeInTheDocument()
    }
    expect(screen.getAllByRole('link').map((l) => l.textContent)).toEqual(['Início', 'Conversas', 'Agenda', 'Conteúdo', 'Mais'])
    expect(screen.queryByRole('link', { name: 'Unidades' })).toBeNull()
  })
  it('contador de Aguardando no ícone de Conversas', () => {
    const { rerender } = render(<BottomNav aguardando={3} />)
    const link = screen.getByRole('link', { name: 'Conversas, 3 aguardando' })
    expect(link).toHaveAttribute('href', '/conversas')
    expect(link).toHaveTextContent('3')
    rerender(<BottomNav aguardando={150} />)
    expect(screen.getByRole('link', { name: 'Conversas, 150 aguardando' })).toHaveTextContent('99+')
    rerender(<BottomNav aguardando={0} />)
    expect(screen.getByRole('link', { name: 'Conversas' })).toBeInTheDocument()
  })
  it('Conversas fica ativa dentro de uma conversa', () => {
    pathname.value = '/conversas/123'
    render(<BottomNav />)
    expect(screen.getByRole('link', { name: 'Conversas' })).toHaveAttribute('aria-current', 'page')
  })
  it('marca o item ativo, inclusive em subpáginas', () => {
    pathname.value = '/conteudo/123'
    render(<BottomNav />)
    expect(screen.getByRole('link', { name: 'Conteúdo' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Início' })).not.toHaveAttribute('aria-current')
    expect(document.querySelectorAll('[aria-current]')).toHaveLength(1)
  })
  it('Agenda fica ativa em /agenda e só nela', () => {
    pathname.value = '/agenda'
    render(<BottomNav />)
    expect(screen.getByRole('link', { name: 'Agenda' })).toHaveAttribute('aria-current', 'page')
    expect(document.querySelectorAll('[aria-current]')).toHaveLength(1)
  })
  it('não confunde prefixos parecidos (/conversasX)', () => {
    pathname.value = '/conversasX'
    render(<BottomNav />)
    expect(screen.getByRole('link', { name: 'Conversas' })).not.toHaveAttribute('aria-current')
    expect(document.querySelectorAll('[aria-current]')).toHaveLength(0)
  })
  it('Início só fica ativo na raiz', () => {
    render(<BottomNav />)
    expect(screen.getByRole('link', { name: 'Início' })).toHaveAttribute('aria-current', 'page')
    expect(document.querySelectorAll('[aria-current]')).toHaveLength(1)
  })
})
