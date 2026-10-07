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
    // nome do Simulador vem do texto sr-only, como nos links
    expect(screen.getByRole('button', { name: 'Simulador' })).not.toHaveAttribute('aria-label')
  })

  it('recolhido em tela baixa ainda rola (os últimos itens ficam alcançáveis)', () => {
    render(<MenuLateral papel="dono" restaurante="R" estadoInicial="recolhido" aguardando={0} />)
    const lista = screen.getByRole('list', { name: 'Gestão' }).parentElement!.parentElement!
    expect(lista.className).toContain('[@media(max-height:640px)]:overflow-y-auto')
  })

  it('só aparece a partir de lg (abaixo disso fica a barra inferior)', () => {
    render(<MenuLateral papel="dono" restaurante="R" estadoInicial="aberto" aguardando={0} />)
    expect(screen.getByRole('navigation', { name: 'Menu principal' }).className).toMatch(/(^|\s)hidden(\s|$)/)
    expect(screen.getByRole('navigation', { name: 'Menu principal' }).className).toContain('lg:flex')
  })
  describe('logo do restaurante', () => {
    const URL_LOGO = 'https://x.test/storage/v1/object/public/marca/r/logo.png'
    it('aberto: logo no quadro de 32 px ao lado do nome, que é cortado com reticências', () => {
      render(<MenuLateral papel="dono" restaurante="Casa Harmonia" logo={URL_LOGO} estadoInicial="aberto" aguardando={0} />)
      const nav = screen.getByRole('navigation', { name: 'Menu principal' })
      // o nome está escrito ao lado: a logo é decorativa (alt vazio), sem leitura dupla
      expect(within(nav).queryByRole('img')).toBeNull()
      const img = nav.querySelector('img')!
      expect(img).toHaveAttribute('alt', '')
      expect(img).toHaveAttribute('src', URL_LOGO)
      expect(img.className).toMatch(/\bsize-8\b/)
      const nome = within(nav).getByText('Casa Harmonia')
      expect(nome.className).toContain('truncate')
      expect(nome.className).toContain('min-w-0')
      expect(img.parentElement).toBe(nome.parentElement)
    })

    it('recolhido: só a logo (sem o nome), junto do botão de abrir', async () => {
      const user = userEvent.setup()
      render(<MenuLateral papel="dono" restaurante="Casa Harmonia" logo={URL_LOGO} estadoInicial="aberto" aguardando={0} />)
      await user.click(screen.getByRole('button', { name: 'Recolher menu' }))
      const nav = screen.getByRole('navigation', { name: 'Menu principal' })
      // sozinha: alt com o nome
      expect(within(nav).getByRole('img', { name: 'Casa Harmonia' })).toBeInTheDocument()
      expect(within(nav).queryByText('Casa Harmonia')).toBeNull()
      expect(within(nav).getByRole('button', { name: 'Abrir menu' })).toBeInTheDocument()
    })

    it('sem logo: o cabeçalho fica igual ao de hoje (aberto e recolhido)', () => {
      for (const estado of ['aberto', 'recolhido'] as const) {
        const { container: sem, unmount } = render(<MenuLateral papel="dono" restaurante="R" estadoInicial={estado} aguardando={0} />)
        const antes = sem.innerHTML
        expect(screen.queryByRole('img')).toBeNull()
        unmount()
        const { container: nulo, unmount: u2 } = render(<MenuLateral papel="dono" restaurante="R" logo={null} estadoInicial={estado} aguardando={0} />)
        expect(nulo.innerHTML).toBe(antes)
        u2()
      }
    })
  })
})
