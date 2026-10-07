import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ usePathname: () => '/' }))
vi.mock('@/app/(painel)/actions', () => ({ setTheme: vi.fn(), signOut: vi.fn() }))

import { AppShell } from './app-shell'
import { TopBar } from './top-bar'

describe('AppShell', () => {
  it('faixa de alertas: no topo abaixo de lg e abaixo da barra superior a partir de lg (uma cópia por faixa de largura)', () => {
    render(
      <AppShell papel="dono" restaurante="R" tema="escuro" menu="aberto" faixa={<section aria-label="Alerta de gastos">x</section>}>
        <TopBar title="Início" />
      </AppShell>,
    )
    const faixas = screen.getAllByRole('region', { name: 'Alerta de gastos', hidden: true })
    expect(faixas).toHaveLength(2)
    const [topo, desktop] = faixas
    expect(topo!.parentElement!.className).toContain('lg:hidden')
    expect(desktop!.parentElement!.className).toContain('lg:block')
    expect(screen.getByRole('banner').compareDocumentPosition(desktop!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('com faixa, reserva a altura dela (--faixa-alertas) para o simulador flutuante começar abaixo; sem faixa, nada', () => {
    const { unmount } = render(
      <AppShell papel="dono" restaurante="R" tema="escuro" menu="aberto" faixa={<section aria-label="Alerta de gastos">x</section>}
        floating={<div data-testid="flutuante" />}>
        <TopBar title="Início" />
      </AppShell>,
    )
    const comFaixa = screen.getByTestId('flutuante').closest<HTMLElement>('[style]')
    expect(comFaixa?.style.getPropertyValue('--faixa-alertas')).toBe('4rem')
    unmount()
    render(
      <AppShell papel="dono" restaurante="R" tema="escuro" menu="aberto" floating={<div data-testid="flutuante" />}>
        <TopBar title="Início" />
      </AppShell>,
    )
    expect(screen.getByTestId('flutuante').closest<HTMLElement>('[style]')?.style.getPropertyValue('--faixa-alertas') ?? '').toBe('')
  })
  describe('logo do restaurante', () => {
    const URL_LOGO = 'https://x.test/storage/v1/object/public/marca/r/logo.webp'
    it('topo do celular: logo de 24 px e nome acima do título, só abaixo de lg; o menu lateral recebe a logo', () => {
      render(
        <AppShell papel="dono" restaurante="Casa Harmonia" logo={URL_LOGO} tema="escuro" menu="aberto">
          <TopBar title="Início" />
        </AppShell>,
      )
      const topo = within(screen.getByRole('banner')).getByRole('img', { name: 'Casa Harmonia' })
      expect(topo).toHaveAttribute('width', '24')
      expect(topo.className).toMatch(/\bsize-6\b/)
      expect(topo.className).toContain('object-contain')
      const marca = topo.parentElement!
      expect(marca.className).toContain('lg:hidden')
      expect(within(marca).getByText('Casa Harmonia').className).toContain('truncate')
      expect(within(screen.getByRole('navigation', { name: 'Menu principal' })).getByRole('img', { name: 'Casa Harmonia' })).toHaveAttribute('width', '32')
    })

    it('sem logo: a barra superior fica igual à de hoje', () => {
      const { container, unmount } = render(
        <AppShell papel="dono" restaurante="R" tema="escuro" menu="aberto"><TopBar title="Início" /></AppShell>,
      )
      const antes = container.innerHTML
      expect(screen.queryByRole('img')).toBeNull()
      unmount()
      const { container: c2 } = render(
        <AppShell papel="dono" restaurante="R" logo={null} tema="escuro" menu="aberto"><TopBar title="Início" /></AppShell>,
      )
      expect(c2.innerHTML).toBe(antes)
    })
  })
})
