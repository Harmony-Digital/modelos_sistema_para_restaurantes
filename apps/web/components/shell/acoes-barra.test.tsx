import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/app/(painel)/actions', () => ({ setTheme: vi.fn(), signOut: vi.fn() }))

import { AcoesBarra, ShellProvider } from './acoes-barra'

describe('AcoesBarra (barra superior no desktop)', () => {
  it('sem o shell em volta não mostra nada (telas fora do painel)', () => {
    const { container } = render(<AcoesBarra />)
    expect(container).toBeEmptyDOMElement()
  })
  it('busca rápida desabilitada até a paleta existir, tema oposto ao atual e conta com Sair; só a partir de lg', () => {
    render(<ShellProvider valor={{ tema: 'escuro', papel: 'gerente' }}><AcoesBarra /></ShellProvider>)
    const busca = screen.getByRole('button', { name: /Busca rápida/ })
    expect(busca).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Usar tema claro' })).toHaveAttribute('type', 'submit')
    expect(document.querySelector('input[name="tema"]')).toHaveValue('claro')
    expect(screen.getByRole('link', { name: 'Conta e ajustes (Gerente)' })).toHaveAttribute('href', '/ajustes')
    expect(screen.getByRole('button', { name: 'Sair' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Ações do painel' }).className).toMatch(/(^|\s)hidden(\s|$)/)
  })
  it('no tema claro oferece o escuro', () => {
    render(<ShellProvider valor={{ tema: 'claro', papel: 'dono' }}><AcoesBarra /></ShellProvider>)
    expect(screen.getByRole('button', { name: 'Usar tema escuro' })).toBeInTheDocument()
    expect(document.querySelector('input[name="tema"]')).toHaveValue('escuro')
  })
})
