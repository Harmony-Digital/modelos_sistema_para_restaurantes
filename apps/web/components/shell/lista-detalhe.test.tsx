import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/app/(painel)/actions', () => ({ setTheme: vi.fn(), signOut: vi.fn() }))

import { ShellProvider } from './acoes-barra'
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
    // altura pelo flex (barra + faixa + o resto), sem calc com a altura da barra fixa no código
    expect(lista.parentElement!.className).not.toMatch(/calc\(/)
    expect(lista.parentElement!.className.split(' ')).toEqual(expect.arrayContaining(['lg:min-h-0', 'lg:flex-1']))
    const tela = lista.parentElement!.parentElement!
    expect(tela.className.split(' ')).toEqual(expect.arrayContaining(['lg:flex', 'lg:h-dvh', 'lg:flex-col']))
    expect(barra.parentElement).toBe(tela)
    expect(barra.className.split(' ')).toContain('shrink-0')
  })

  it('lg+: a faixa de alertas fica entre a barra e as colunas, sem encolher, e as colunas ocupam só o resto', () => {
    render(
      <ShellProvider valor={{ tema: 'claro', papel: 'dono', faixa: <section aria-label="Alerta de gastos">alerta</section> }}>
        <ListaDetalhe titulo="Conversas" lista={<section aria-label="Lista">lista</section>}>
          <section aria-label="Detalhe">detalhe</section>
        </ListaDetalhe>
      </ShellProvider>,
    )
    const faixa = screen.getByRole('region', { name: 'Alerta de gastos' }).parentElement!
    const colunas = screen.getByRole('region', { name: 'Lista' }).parentElement!
    const tela = colunas.parentElement!
    const filhos = [...tela.children]
    expect(filhos.indexOf(faixa)).toBeGreaterThan(-1)
    expect(filhos.indexOf(faixa)).toBeLessThan(filhos.indexOf(colunas))
    expect(faixa.className.split(' ')).toContain('shrink-0')
  })

  it('TopBar aceita classe extra (some < lg ou ≥ lg conforme a coluna)', () => {
    render(<TopBar title="Maria" className="lg:hidden" />)
    expect(screen.getByRole('banner').className).toMatch(/(^|\s)lg:hidden(\s|$)/)
  })
})
