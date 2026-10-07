import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const pathname = vi.hoisted(() => ({ value: '/' }))
vi.mock('next/navigation', () => ({ usePathname: () => pathname.value }))

import { EVENTO_ABRIR_SIMULADOR } from '@/components/simulator/abrir'
import { BottomNav } from './bottom-nav'

const barra = () => screen.getByRole('navigation', { name: 'Navegação principal' })

describe('BottomNav', () => {
  beforeEach(() => {
    pathname.value = '/'
  })
  it('4 destinos com rótulo e o botão Mais; some a partir de lg', () => {
    render(<BottomNav papel="dono" />)
    expect(within(barra()).getAllByRole('link').map((l) => l.textContent)).toEqual(['Início', 'Conversas', 'Agenda', 'Conteúdo'])
    expect(within(barra()).getByRole('button', { name: 'Mais' })).toBeInTheDocument()
    expect(within(barra()).queryByRole('link', { name: 'Unidades' })).toBeNull()
    expect(barra().className).toContain('lg:hidden')
  })
  it('contador de Aguardando no ícone de Conversas', () => {
    const { rerender } = render(<BottomNav papel="dono" aguardando={3} />)
    const link = screen.getByRole('link', { name: 'Conversas, 3 aguardando' })
    expect(link).toHaveAttribute('href', '/conversas')
    expect(link).toHaveTextContent('3')
    rerender(<BottomNav papel="dono" aguardando={150} />)
    expect(screen.getByRole('link', { name: 'Conversas, 150 aguardando' })).toHaveTextContent('99+')
    rerender(<BottomNav papel="dono" aguardando={0} />)
    expect(screen.getByRole('link', { name: 'Conversas' })).toBeInTheDocument()
  })
  it('Conversas fica ativa dentro de uma conversa', () => {
    pathname.value = '/conversas/123'
    render(<BottomNav papel="dono" />)
    expect(screen.getByRole('link', { name: 'Conversas' })).toHaveAttribute('aria-current', 'page')
  })
  it('marca o item ativo, inclusive em subpáginas', () => {
    pathname.value = '/conteudo/123'
    render(<BottomNav papel="dono" />)
    expect(screen.getByRole('link', { name: 'Conteúdo' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Início' })).not.toHaveAttribute('aria-current')
    expect(document.querySelectorAll('[aria-current]')).toHaveLength(1)
  })
  it('Agenda fica ativa em /agenda e só nela', () => {
    pathname.value = '/agenda'
    render(<BottomNav papel="dono" />)
    expect(screen.getByRole('link', { name: 'Agenda' })).toHaveAttribute('aria-current', 'page')
    expect(document.querySelectorAll('[aria-current]')).toHaveLength(1)
  })
  it('não confunde prefixos parecidos (/conversasX)', () => {
    pathname.value = '/conversasX'
    render(<BottomNav papel="dono" />)
    expect(screen.getByRole('link', { name: 'Conversas' })).not.toHaveAttribute('aria-current')
    expect(document.querySelectorAll('[aria-current]')).toHaveLength(0)
  })
  it('Início só fica ativo na raiz', () => {
    render(<BottomNav papel="dono" />)
    expect(screen.getByRole('link', { name: 'Início' })).toHaveAttribute('aria-current', 'page')
    expect(document.querySelectorAll('[aria-current]')).toHaveLength(1)
  })
  it('Mais fica marcado nas telas que moram na folha (Gestão, Ajustes, Unidades)', () => {
    pathname.value = '/gestao/gastos'
    render(<BottomNav papel="dono" />)
    expect(screen.getByRole('button', { name: 'Mais' })).toHaveAttribute('aria-current', 'page')
    expect(document.querySelectorAll('[aria-current]')).toHaveLength(1)
  })
  it('folha Mais do dono: Simulador, Unidades e Gestão; o Simulador abre sem navegar', async () => {
    const ouvinte = vi.fn()
    window.addEventListener(EVENTO_ABRIR_SIMULADOR, ouvinte)
    render(<BottomNav papel="dono" />)
    await userEvent.click(screen.getByRole('button', { name: 'Mais' }))
    const folha = screen.getByRole('dialog', { name: 'Mais' })
    expect(within(folha).getAllByRole('link').map((l) => [l.textContent, l.getAttribute('href')])).toEqual([
      ['Unidades', '/unidades'], ['Gastos', '/gestao/gastos'], ['Equipe', '/gestao/equipe'],
      ['Privacidade', '/gestao/privacidade'], ['Ajustes', '/ajustes'],
    ])
    await userEvent.click(within(folha).getByRole('button', { name: 'Simulador' }))
    expect(ouvinte).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog', { name: 'Mais' })).toBeNull()
    window.removeEventListener(EVENTO_ABRIR_SIMULADOR, ouvinte)
  })
  it('folha Mais do atendente: só Unidades e Ajustes', async () => {
    render(<BottomNav papel="atendente" />)
    await userEvent.click(screen.getByRole('button', { name: 'Mais' }))
    const folha = screen.getByRole('dialog', { name: 'Mais' })
    expect(within(folha).getAllByRole('link').map((l) => l.textContent)).toEqual(['Unidades', 'Ajustes'])
    expect(within(folha).queryByRole('button', { name: 'Simulador' })).toBeNull()
  })
})
