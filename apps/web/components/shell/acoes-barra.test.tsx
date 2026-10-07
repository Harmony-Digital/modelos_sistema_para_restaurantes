import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/app/(painel)/actions', () => ({ setTheme: vi.fn(), signOut: vi.fn() }))

import { EVENTO_ABRIR_BUSCA } from './abrir-busca'
import { AcoesBarra, ShellProvider } from './acoes-barra'
import { TopBar } from './top-bar'

describe('AcoesBarra (barra superior no desktop)', () => {
  it('sem o shell em volta não mostra nada (telas fora do painel)', () => {
    const { container } = render(<AcoesBarra />)
    expect(container).toBeEmptyDOMElement()
  })
  it('busca rápida abre a paleta (Ctrl+K), tema oposto ao atual e conta com Sair; só a partir de lg', () => {
    render(<ShellProvider valor={{ tema: 'escuro', papel: 'gerente' }}><AcoesBarra /></ShellProvider>)
    const busca = screen.getByRole('button', { name: /Busca rápida/ })
    expect(busca).toBeEnabled()
    expect(busca).toHaveAttribute('aria-keyshortcuts', 'Control+K Meta+K')
    const ouvir = vi.fn()
    window.addEventListener(EVENTO_ABRIR_BUSCA, ouvir)
    fireEvent.click(busca)
    window.removeEventListener(EVENTO_ABRIR_BUSCA, ouvir)
    expect(ouvir).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Usar tema claro' })).toHaveAttribute('type', 'submit')
    expect(document.querySelector('input[name="tema"]')).toHaveValue('claro')
    expect(screen.getByRole('link', { name: 'Conta e ajustes (Gerente)' })).toHaveAttribute('href', '/ajustes')
    expect(screen.getByRole('button', { name: 'Sair' })).toBeInTheDocument()
    // alvo de toque ≥ 44 px (tablet em paisagem já é lg)
    for (const nome of ['Usar tema claro', 'Sair']) expect(screen.getByRole('button', { name: nome }).className).toContain('size-11')
    expect(screen.getByRole('link', { name: 'Conta e ajustes (Gerente)' }).className).toContain('size-11')
    expect(screen.getByRole('group', { name: 'Ações do painel' }).className).toMatch(/(^|\s)hidden(\s|$)/)
  })
  it('faixa de alertas abaixo da barra superior só a partir de lg (abaixo de lg o AppShell a põe no topo)', () => {
    render(
      <ShellProvider valor={{ tema: 'escuro', papel: 'dono', faixa: <section aria-label="Alerta de gastos">x</section> }}>
        <TopBar title="Início" />
      </ShellProvider>,
    )
    const header = screen.getByRole('banner')
    const faixa = screen.getByRole('region', { name: 'Alerta de gastos' })
    expect(header.compareDocumentPosition(faixa) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(header.contains(faixa)).toBe(false)
    expect(faixa.parentElement!.className).toMatch(/(^|\s)hidden(\s|$)/)
    expect(faixa.parentElement!.className).toContain('lg:block')
  })
  it('no tema claro oferece o escuro', () => {
    render(<ShellProvider valor={{ tema: 'claro', papel: 'dono' }}><AcoesBarra /></ShellProvider>)
    expect(screen.getByRole('button', { name: 'Usar tema escuro' })).toBeInTheDocument()
    expect(document.querySelector('input[name="tema"]')).toHaveValue('escuro')
  })
})
