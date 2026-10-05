import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { formatUsd, SpendCard } from './spend-card'

const gastos = { ia: { dia: '0.123400', mes: '2.500000' }, whatsapp: { dia: '0.062500', mes: '1.250000' } }

describe('formatUsd', () => {
  it('usa 4 casas abaixo de US$ 1 e 2 casas a partir de US$ 1', () => {
    expect(formatUsd('0.123400')).toBe('US$ 0,1234')
    expect(formatUsd('2.500000')).toBe('US$ 2,50')
    expect(formatUsd('1234.5')).toBe('US$ 1.234,50')
  })
  it('null ou vazio vira zero', () => {
    expect(formatUsd(null)).toBe('US$ 0,0000')
  })
})

describe('SpendCard', () => {
  it('mostra IA, WhatsApp (API oficial) e total, de hoje e do mês, numa tabela', () => {
    render(<SpendCard gastos={gastos} />)
    const tabela = screen.getByRole('table', { name: 'Gastos' })
    expect(within(tabela).getByRole('columnheader', { name: 'Hoje' })).toBeInTheDocument()
    expect(within(tabela).getByRole('columnheader', { name: 'No mês' })).toBeInTheDocument()
    const ia = within(tabela).getByRole('row', { name: /^IA/ })
    expect(within(ia).getByText('US$ 0,1234')).toBeInTheDocument()
    expect(within(ia).getByText('US$ 2,50')).toBeInTheDocument()
    const wa = within(tabela).getByRole('row', { name: /WhatsApp/ })
    expect(within(wa).getByText('US$ 0,0625')).toBeInTheDocument()
    expect(within(wa).getByText('US$ 1,25')).toBeInTheDocument()
    const total = within(tabela).getByRole('row', { name: /^Total/ })
    expect(within(total).getByText('US$ 0,1859')).toBeInTheDocument()
    expect(within(total).getByText('US$ 3,75')).toBeInTheDocument()
  })
  it('soma sem erro de ponto flutuante', () => {
    render(<SpendCard gastos={{ ia: { dia: '0.1', mes: null }, whatsapp: { dia: '0.2', mes: null } }} />)
    const total = screen.getByRole('row', { name: /^Total/ })
    expect(within(total).getByText('US$ 0,3000')).toBeInTheDocument()
  })
})
