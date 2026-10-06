import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const pathname = vi.hoisted(() => ({ value: '/' }))
vi.mock('next/navigation', () => ({ usePathname: () => pathname.value }))

import { BottomNav } from './bottom-nav'

describe('BottomNav', () => {
  beforeEach(() => {
    pathname.value = '/'
  })
  it('mostra os 5 destinos com rótulo, na ordem', () => {
    render(<BottomNav />)
    for (const nome of ['Início', 'Previsão', 'Unidades', 'Respostas', 'Mais']) {
      expect(screen.getByRole('link', { name: nome })).toBeInTheDocument()
    }
    expect(screen.getAllByRole('link').map((l) => l.textContent)).toEqual(['Início', 'Previsão', 'Unidades', 'Respostas', 'Mais'])
  })
  it('marca o item ativo, inclusive em subpáginas', () => {
    pathname.value = '/unidades/123'
    render(<BottomNav />)
    expect(screen.getByRole('link', { name: 'Unidades' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Início' })).not.toHaveAttribute('aria-current')
    expect(document.querySelectorAll('[aria-current]')).toHaveLength(1)
  })
  it('Previsão fica ativa em /previsao e só nela', () => {
    pathname.value = '/previsao'
    render(<BottomNav />)
    expect(screen.getByRole('link', { name: 'Previsão' })).toHaveAttribute('aria-current', 'page')
    expect(document.querySelectorAll('[aria-current]')).toHaveLength(1)
  })
  it('não confunde prefixos parecidos (/unidadesX)', () => {
    pathname.value = '/unidadesX'
    render(<BottomNav />)
    expect(screen.getByRole('link', { name: 'Unidades' })).not.toHaveAttribute('aria-current')
    expect(document.querySelectorAll('[aria-current]')).toHaveLength(0)
  })
  it('Início só fica ativo na raiz', () => {
    render(<BottomNav />)
    expect(screen.getByRole('link', { name: 'Início' })).toHaveAttribute('aria-current', 'page')
    expect(document.querySelectorAll('[aria-current]')).toHaveLength(1)
  })
})
