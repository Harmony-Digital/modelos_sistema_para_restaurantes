import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AoVivo } from './ao-vivo'
import { EtiquetaStatus } from './etiqueta-status'
import { Numero } from './numero'
import { Tabela, TabelaCabecalho, TabelaCelula, TabelaCelulaCabecalho, TabelaCorpo, TabelaLinha } from './tabela'

describe('EtiquetaStatus', () => {
  it('texto mono caixa-alta (o texto do DOM não muda)', () => {
    render(<EtiquetaStatus variante="aguarda">Aguardando</EtiquetaStatus>)
    const e = screen.getByText('Aguardando')
    expect(e.className).toMatch(/font-mono/)
    expect(e.className).toMatch(/uppercase/)
    expect(e.dataset.variante).toBe('aguarda')
  })
  it.each([
    ['aguarda', 'text-warning'], ['novo', 'text-warning'], ['ia', 'text-success'], ['confirmado', 'text-success'],
    ['ok', 'text-success'], ['humano', 'text-info'], ['em_contato', 'text-info'], ['erro', 'text-destructive'],
    ['simulacao', 'text-muted-foreground'], ['recusado', 'text-muted-foreground'], ['cancelado', 'text-muted-foreground'],
    ['encerrada', 'text-muted-foreground'],
  ] as const)('%s usa %s', (variante, cor) => {
    render(<EtiquetaStatus variante={variante}>x</EtiquetaStatus>)
    expect(screen.getByText('x').className).toContain(cor)
  })
  it('nunca usa texto branco nem cor fora dos tokens', () => {
    render(<EtiquetaStatus variante="erro">x</EtiquetaStatus>)
    expect(screen.getByText('x').className).not.toMatch(/text-white|#[0-9a-f]{3,6}/i)
  })
})

describe('Numero', () => {
  it('mono com algarismos tabulares e tamanho', () => {
    render(<Numero tamanho="lg">1.234</Numero>)
    const n = screen.getByText('1.234')
    expect(n.className).toMatch(/font-mono/)
    expect(n.className).toMatch(/tabular-nums/)
    expect(n.className).toMatch(/text-2xl/)
  })
  it('tamanho padrão é o do texto ao redor', () => {
    render(<Numero>42</Numero>)
    expect(screen.getByText('42').className).not.toMatch(/text-(xs|sm|lg|xl|2xl|3xl)/)
  })
})

describe('Tabela', () => {
  function Exemplo({ selecionada }: { selecionada?: boolean | undefined }) {
    return (
      <Tabela aria-label="Fila">
        <TabelaCabecalho><TabelaLinha><TabelaCelulaCabecalho>Cliente</TabelaCelulaCabecalho></TabelaLinha></TabelaCabecalho>
        <TabelaCorpo><TabelaLinha selecionada={selecionada}><TabelaCelula>Maria</TabelaCelula></TabelaLinha></TabelaCorpo>
      </Tabela>
    )
  }
  it('cabeçalho mono pequeno em caixa-alta e rolagem horizontal própria', () => {
    render(<Exemplo />)
    const th = screen.getByRole('columnheader', { name: 'Cliente' })
    expect(th.className).toMatch(/font-mono/)
    expect(th.className).toMatch(/uppercase/)
    expect(th.className).toMatch(/text-\[11px\]/)
    expect(screen.getByRole('table', { name: 'Fila' }).parentElement!.className).toMatch(/overflow-x-auto/)
  })
  it('linha selecionada marca aria-current e a barra laranja à esquerda', () => {
    render(<Exemplo selecionada />)
    const tr = screen.getByRole('row', { name: 'Maria' })
    expect(tr).toHaveAttribute('aria-current', 'true')
    expect(tr.className).toMatch(/var\(--primary\)/)
    // etiqueta de sucesso na linha fica AA: sem tint accent/muted
    expect(tr.className).not.toMatch(/(^|\s)bg-accent/)
  })
  it('linha comum não tem aria-current', () => {
    render(<Exemplo />)
    expect(screen.getByRole('row', { name: 'Maria' })).not.toHaveAttribute('aria-current')
  })
})

describe('AoVivo', () => {
  it('ponto decorativo + "Ao vivo" em mono caixa-alta, anúncio educado', () => {
    render(<AoVivo />)
    const s = screen.getByRole('status')
    expect(s).toHaveAttribute('aria-live', 'polite')
    expect(s).toHaveTextContent('Ao vivo')
    expect(s.className).toMatch(/font-mono/)
    expect(s.className).toMatch(/uppercase/)
    expect(s.className).toMatch(/text-success/)
    expect(s.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })
})
