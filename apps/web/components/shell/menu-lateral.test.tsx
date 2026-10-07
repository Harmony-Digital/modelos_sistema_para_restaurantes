import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const pathname = vi.hoisted(() => ({ value: '/' }))
vi.mock('next/navigation', () => ({ usePathname: () => pathname.value }))

import { EVENTO_ABRIR_SIMULADOR } from '@/components/simulator/abrir'
import { MenuLateral } from './menu-lateral'

const limparCookie = () => { document.cookie = 'atd_menu=; path=/; max-age=0' }

describe('MenuLateral', () => {
  beforeEach(() => {
    pathname.value = '/'
    limparCookie()
  })
  afterEach(limparCookie)

  it('dono: nome do restaurante, grupos Atendimento/Restaurante/Gestão e todas as rotas', () => {
    render(<MenuLateral papel="dono" restaurante="Restaurante Demo" estadoInicial="aberto" aguardando={0} />)
    const nav = screen.getByRole('navigation', { name: 'Menu principal' })
    expect(within(nav).getByText('Restaurante Demo')).toBeInTheDocument()
    for (const g of ['Atendimento', 'Restaurante', 'Gestão']) expect(within(nav).getByRole('list', { name: g })).toBeInTheDocument()
    const hrefs = within(nav).getAllByRole('link').map((l) => [l.textContent, l.getAttribute('href')])
    expect(hrefs).toEqual([
      ['Início', '/'], ['Conversas', '/conversas'], ['Agenda', '/agenda'], ['Conteúdo', '/conteudo'], ['Unidades', '/unidades'],
      ['Gastos', '/gestao/gastos'], ['Equipe', '/gestao/equipe'], ['Privacidade', '/gestao/privacidade'], ['Ajustes', '/ajustes'],
    ])
    expect(within(nav).getByRole('button', { name: 'Simulador' })).toBeInTheDocument()
  })

  it('gerente restrito vê o mesmo menu de gerente; atendente não vê Simulador, Gastos, Equipe nem Privacidade', () => {
    const { unmount } = render(<MenuLateral papel="gerente" restaurante="R" estadoInicial="aberto" aguardando={0} />)
    expect(screen.getByRole('link', { name: 'Gastos' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Simulador' })).toBeInTheDocument()
    unmount()
    render(<MenuLateral papel="atendente" restaurante="R" estadoInicial="aberto" aguardando={0} />)
    for (const n of ['Gastos', 'Equipe', 'Privacidade']) expect(screen.queryByRole('link', { name: n })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Simulador' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Ajustes' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Conversas' })).toBeInTheDocument()
  })

  it('marca só o item ativo, inclusive em subpáginas', () => {
    pathname.value = '/gestao/gastos'
    const { rerender } = render(<MenuLateral papel="dono" restaurante="R" estadoInicial="aberto" aguardando={0} />)
    expect(screen.getByRole('link', { name: 'Gastos' })).toHaveAttribute('aria-current', 'page')
    expect(document.querySelectorAll('[aria-current]')).toHaveLength(1)
    pathname.value = '/conversas/123'
    rerender(<MenuLateral papel="dono" restaurante="R" estadoInicial="aberto" aguardando={0} />)
    expect(screen.getByRole('link', { name: 'Conversas' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Início' })).not.toHaveAttribute('aria-current')
  })

  it('contador de aguardando em Conversas (99+ acima de 99)', () => {
    const { rerender } = render(<MenuLateral papel="atendente" restaurante="R" estadoInicial="aberto" aguardando={3} />)
    expect(screen.getByRole('link', { name: 'Conversas, 3 aguardando' })).toHaveTextContent('3')
    rerender(<MenuLateral papel="atendente" restaurante="R" estadoInicial="aberto" aguardando={150} />)
    expect(screen.getByRole('link', { name: 'Conversas, 150 aguardando' })).toHaveTextContent('99+')
  })

  it('Simulador abre o simulador sem navegar', async () => {
    const ouvinte = vi.fn()
    window.addEventListener(EVENTO_ABRIR_SIMULADOR, ouvinte)
    render(<MenuLateral papel="dono" restaurante="R" estadoInicial="aberto" aguardando={0} />)
    await userEvent.click(screen.getByRole('button', { name: 'Simulador' }))
    expect(ouvinte).toHaveBeenCalledTimes(1)
    window.removeEventListener(EVENTO_ABRIR_SIMULADOR, ouvinte)
  })

  it('recolher e abrir: grava o cookie, mantém os nomes acessíveis e esconde só o texto', async () => {
    render(<MenuLateral papel="dono" restaurante="Restaurante Demo" estadoInicial="aberto" aguardando={2} />)
    const nav = screen.getByRole('navigation', { name: 'Menu principal' })
    expect(nav).toHaveAttribute('data-estado', 'aberto')
    await userEvent.click(screen.getByRole('button', { name: 'Recolher menu' }))
    expect(nav).toHaveAttribute('data-estado', 'recolhido')
    expect(document.cookie).toContain('atd_menu=recolhido')
    // recolhido: só ícones, mas o nome continua para leitor de tela e a dica aparece no hover/foco
    expect(screen.getByRole('link', { name: 'Início' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Conversas, 2 aguardando' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Abrir menu' })).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(screen.getByRole('button', { name: 'Abrir menu' }))
    expect(nav).toHaveAttribute('data-estado', 'aberto')
    expect(document.cookie).toContain('atd_menu=aberto')
    expect(screen.getByRole('button', { name: 'Recolher menu' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('nasce recolhido quando o servidor leu o cookie (sem piscar)', () => {
    render(<MenuLateral papel="dono" restaurante="R" estadoInicial="recolhido" aguardando={0} />)
    expect(screen.getByRole('navigation', { name: 'Menu principal' })).toHaveAttribute('data-estado', 'recolhido')
    expect(screen.getByRole('button', { name: 'Abrir menu' })).toBeInTheDocument()
  })

  it('só aparece a partir de lg (abaixo disso fica a barra inferior)', () => {
    render(<MenuLateral papel="dono" restaurante="R" estadoInicial="aberto" aguardando={0} />)
    expect(screen.getByRole('navigation', { name: 'Menu principal' }).className).toMatch(/(^|\s)hidden(\s|$)/)
    expect(screen.getByRole('navigation', { name: 'Menu principal' }).className).toContain('lg:flex')
  })
})
