import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SpendCard } from './spend-card'

const gastos = {
  ia: { dia: '0.123400', mes: '2.500000' },
  simulacao: { dia: '0.010000', mes: '0.300000' },
  whatsapp: { dia: '0.062500', mes: '1.250000' },
}

describe('SpendCard', () => {
  it('mostra IA (com o provedor real), WhatsApp e total em US$ e R$, de hoje e do mês, numa tabela', () => {
    render(<SpendCard gastos={gastos} cotacao="5.0000" provedor="OpenAI" />)
    const tabela = screen.getByRole('table', { name: 'Gastos' })
    expect(within(tabela).getByRole('columnheader', { name: 'Hoje' })).toBeInTheDocument()
    expect(within(tabela).getByRole('columnheader', { name: 'No mês' })).toBeInTheDocument()
    const ia = within(tabela).getByRole('row', { name: /^IA \(clientes\)/ })
    expect(within(ia).getByText('OpenAI')).toBeInTheDocument()
    expect(within(ia).getByText('US$ 0,1234')).toBeInTheDocument()
    expect(within(ia).getByText('R$ 0,62')).toBeInTheDocument()
    expect(within(ia).getByText('US$ 2,50')).toBeInTheDocument()
    expect(within(ia).getByText('R$ 12,50')).toBeInTheDocument()
    const wa = within(tabela).getByRole('row', { name: /WhatsApp/ })
    expect(within(wa).getByText('US$ 0,0625')).toBeInTheDocument()
    expect(within(wa).getByText('US$ 1,25')).toBeInTheDocument()
    const total = within(tabela).getByRole('row', { name: /^Total/ })
    expect(within(total).getByText('US$ 0,1859')).toBeInTheDocument()
    expect(within(total).getByText('US$ 3,75')).toBeInTheDocument()
    expect(within(total).getByText('R$ 18,75')).toBeInTheDocument()
  })

  it('simulação aparece à parte e fora do total', () => {
    render(<SpendCard gastos={gastos} cotacao="5" provedor="OpenRouter" />)
    const sim = screen.getByRole('row', { name: /^Simulação/ })
    expect(within(sim).getByText('US$ 0,0100')).toBeInTheDocument()
    expect(within(sim).getByText('US$ 0,3000')).toBeInTheDocument()
    expect(within(sim).getByText(/fora do total/)).toBeInTheDocument()
    expect(within(screen.getByRole('row', { name: /^IA/ })).getByText('OpenRouter')).toBeInTheDocument()
  })

  it('soma sem erro de ponto flutuante; vazio vira zero', () => {
    render(<SpendCard gastos={{ ia: { dia: '0.1', mes: null }, simulacao: { dia: null, mes: null }, whatsapp: { dia: '0.2', mes: null } }} cotacao="5.5" provedor="OpenAI" />)
    const total = screen.getByRole('row', { name: /^Total/ })
    expect(within(total).getByText('US$ 0,3000')).toBeInTheDocument()
    expect(within(total).getByText('US$ 0,0000')).toBeInTheDocument()
    expect(within(total).getByText('R$ 1,65')).toBeInTheDocument()
  })

  it('diz a cotação usada e leva para Gastos e limites', () => {
    render(<SpendCard gastos={gastos} cotacao="5.4321" provedor="OpenAI" />)
    expect(screen.getByText(/US\$ 1 = R\$ 5,4321/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver gastos e limites' })).toHaveAttribute('href', '/mais/gastos')
  })
})
