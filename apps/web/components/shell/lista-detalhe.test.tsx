import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/app/(painel)/actions', () => ({ setTheme: vi.fn(), signOut: vi.fn() }))

import { ListaDetalhe } from './lista-detalhe'
import { TopBar } from './top-bar'

describe('ListaDetalhe (layout de Conversas e Unidades)', () => {
  it('lg+: barra com o título da seção e as duas colunas lado a lado, na altura da tela', () => {
    render(
      <ListaDetalhe titulo="Conversas" subtitulo="Atendimento" lista={<section aria-label="Lista">lista</section>}>
        <section aria-label="Detalhe">detalhe</section>
      </ListaDetalhe>,
    )
    const barra = screen.getByRole('heading', { level: 1, name: 'Conversas' }).closest('header')!
    // < lg cada coluna mostra a própria barra; a do layout só aparece a partir de lg
    expect(barra.className.split(' ')).toEqual(expect.arrayContaining(['hidden', 'lg:block']))
    const lista = screen.getByRole('region', { name: 'Lista' })
    const detalhe = screen.getByRole('region', { name: 'Detalhe' })
    expect(lista.parentElement).toBe(detalhe.parentElement)
    expect(lista.parentElement!.className).toMatch(/lg:flex/)
    expect(lista.parentElement!.className).toMatch(/lg:h-\[calc\(100dvh/)
  })

  it('TopBar aceita classe extra (some < lg ou ≥ lg conforme a coluna)', () => {
    render(<TopBar title="Maria" className="lg:hidden" />)
    expect(screen.getByRole('banner').className).toMatch(/(^|\s)lg:hidden(\s|$)/)
  })
})
