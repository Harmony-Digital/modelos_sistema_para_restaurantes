import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const pathname = vi.hoisted(() => ({ value: '/' }))
vi.mock('next/navigation', () => ({ usePathname: () => pathname.value }))

import { BottomNav } from './bottom-nav'

describe('BottomNav', () => {
  it('mostra os 4 destinos com rótulo', () => {
    render(<BottomNav />)
    for (const nome of ['Início', 'Unidades', 'Respostas', 'Mais']) {
      expect(screen.getByRole('link', { name: nome })).toBeInTheDocument()
    }
  })
  it('marca o item ativo, inclusive em subpáginas', () => {
    pathname.value = '/unidades/123'
    render(<BottomNav />)
    expect(screen.getByRole('link', { name: 'Unidades' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Início' })).not.toHaveAttribute('aria-current')
  })
  it('Início só fica ativo na raiz', () => {
    pathname.value = '/'
    render(<BottomNav />)
    expect(screen.getByRole('link', { name: 'Início' })).toHaveAttribute('aria-current', 'page')
  })
})
