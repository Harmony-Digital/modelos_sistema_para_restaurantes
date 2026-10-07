import { render, screen } from '@testing-library/react'
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
})
