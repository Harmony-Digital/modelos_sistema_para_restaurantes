import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CartaoAlertasGastos, FaixaAlertaGastos } from './alerta-gastos'

const a80 = { escopo: 'ia' as const, periodo: 'dia' as const, nivel: 80 as const, inicioPeriodo: '2026-10-06', usoUsd: '1.64', limiteUsd: '2', criadoEm: new Date(), limiteAlteradoDepois: false }
const a100 = { ...a80, escopo: 'simulacao' as const, periodo: 'mes' as const, nivel: 100 as const, inicioPeriodo: '2026-10-01', usoUsd: '10', limiteUsd: '10' }

describe('FaixaAlertaGastos', () => {
  it('sem alerta não mostra nada', () => {
    const { container } = render(<FaixaAlertaGastos alertas={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('mostra o alerta mais grave primeiro, quantos outros há e o botão Ajustar limites', () => {
    render(<FaixaAlertaGastos alertas={[a80, a100]} />)
    const faixa = screen.getByRole('region', { name: 'Alerta de gastos' })
    expect(within(faixa).getByText('Simulação: 100% do limite do mês')).toBeInTheDocument()
    expect(within(faixa).getByText(/e mais 1 alerta/)).toBeInTheDocument()
    expect(within(faixa).getByText(/modo econômico/)).toBeInTheDocument()
    expect(within(faixa).getByRole('link', { name: 'Ajustar limites' })).toHaveAttribute('href', '/mais/gastos')
  })

  it('só 80%: avisa sem dizer que parou', () => {
    render(<FaixaAlertaGastos alertas={[a80]} />)
    expect(screen.getByText('IA: 82% do limite do dia')).toBeInTheDocument()
    expect(screen.queryByText(/modo econômico/)).toBeNull()
    expect(screen.queryByText(/e mais/)).toBeNull()
  })
})

describe('limite aumentado depois do alerta de 100%', () => {
  it('faixa e cartão mostram o % atual, sem "modo econômico"', () => {
    const subiu = { ...a100, limiteUsd: '20', limiteAlteradoDepois: true }
    render(<><FaixaAlertaGastos alertas={[subiu]} /><CartaoAlertasGastos alertas={[subiu]} /></>)
    expect(screen.getAllByText(/Simulação: 50% do limite do mês/)).toHaveLength(2)
    expect(screen.queryByText(/modo econômico/)).toBeNull()
  })
})

describe('CartaoAlertasGastos', () => {
  it('lista todos os alertas do período com o botão Ajustar limites', () => {
    render(<CartaoAlertasGastos alertas={[a80, a100]} />)
    const cartao = screen.getByRole('region', { name: 'Alertas de gasto' })
    const itens = within(cartao).getAllByRole('listitem')
    expect(itens.map((i) => i.textContent)).toEqual([expect.stringContaining('Simulação: 100% do limite do mês'), expect.stringContaining('IA: 82% do limite do dia')])
    expect(within(cartao).getByRole('link', { name: 'Ajustar limites' })).toHaveAttribute('href', '/mais/gastos')
  })

  it('sem alerta não aparece', () => {
    const { container } = render(<CartaoAlertasGastos alertas={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
