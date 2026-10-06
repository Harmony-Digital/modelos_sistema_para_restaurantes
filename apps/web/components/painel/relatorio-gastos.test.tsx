import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RelatorioGastos } from './relatorio-gastos'

const meses = [{ valor: '2026-10', rotulo: 'outubro de 2026' }, { valor: '2026-09', rotulo: 'setembro de 2026' }]
const vazio = { porDia: [], porEtapa: [], porModelo: [], porUnidade: [], totalRealUsd: '0', totalSimulacaoUsd: '0', conversasReais: 0 }
const cheio = {
  porDia: [{ dia: '2026-09-03', realUsd: '1.200000', simulacaoUsd: '0.050000' }],
  porEtapa: [{ etapa: 'triagem', realUsd: '0.200000', simulacaoUsd: '0.010000' }, { etapa: 'ingestao', realUsd: '1.000000', simulacaoUsd: '0' }],
  porModelo: [{ modelo: 'gpt-4.1-mini', realUsd: '1.200000', simulacaoUsd: '0.050000' }],
  porUnidade: [{ unitId: 'u1', unidade: 'Centro', realUsd: '0.200000' }, { unitId: null, unidade: null, realUsd: '1.000000' }],
  totalRealUsd: '1.200000',
  totalSimulacaoUsd: '0.050000',
  conversasReais: 4,
}

describe('RelatorioGastos', () => {
  it('mês vazio ensina de onde vêm os custos e mantém o seletor de mês', () => {
    render(<RelatorioGastos mes="2026-10" meses={meses} linhas={vazio} cotacao="5" />)
    expect(screen.getByText('Nenhum gasto de IA em outubro de 2026')).toBeInTheDocument()
    expect(screen.getByText(/quando a IA responde um cliente/)).toBeInTheDocument()
    expect(screen.getByText(/simulador/)).toBeInTheDocument()
    expect(screen.getByLabelText('Mês')).toHaveValue('2026-10')
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('totais em US$ e R$, simulação à parte e custo médio por conversa real', () => {
    render(<RelatorioGastos mes="2026-09" meses={meses} linhas={cheio} cotacao="5" />)
    const totais = screen.getByRole('group', { name: 'Totais de setembro de 2026' })
    expect(within(totais).getByText('US$ 1,20')).toBeInTheDocument()
    expect(within(totais).getByText('R$ 6,00')).toBeInTheDocument()
    expect(within(totais).getByText('US$ 0,0500')).toBeInTheDocument()
    expect(within(totais).getByText('US$ 0,3000')).toBeInTheDocument() // 1,20 / 4
    expect(within(totais).getByText(/4 conversas/)).toBeInTheDocument()
  })

  it('tabelas por dia, etapa, modelo e unidade, com nomes em português e "Sem unidade" à parte', () => {
    render(<RelatorioGastos mes="2026-09" meses={meses} linhas={cheio} cotacao="5" />)
    const dia = screen.getByRole('table', { name: 'Por dia' })
    expect(within(dia).getByRole('row', { name: /03\/09/ })).toHaveTextContent('US$ 1,20')
    const etapa = screen.getByRole('table', { name: 'Por etapa' })
    expect(within(etapa).getByRole('row', { name: /Triagem/ })).toBeInTheDocument()
    expect(within(etapa).getByRole('row', { name: /Importação do cardápio/ })).toBeInTheDocument()
    expect(within(screen.getByRole('table', { name: 'Por modelo' })).getByText('gpt-4.1-mini')).toBeInTheDocument()
    const unidade = screen.getByRole('table', { name: 'Por unidade (clientes)' })
    expect(within(unidade).getByRole('row', { name: /Centro/ })).toHaveTextContent('R$ 1,00')
    expect(within(unidade).getByRole('row', { name: /Sem unidade/ })).toHaveTextContent('US$ 1,00')
  })

  it('sem conversa real: custo médio vira traço', () => {
    render(<RelatorioGastos mes="2026-09" meses={meses} linhas={{ ...cheio, conversasReais: 0 }} cotacao="5" />)
    const totais = screen.getByRole('group', { name: 'Totais de setembro de 2026' })
    expect(within(totais).getByText('—')).toBeInTheDocument()
  })
})
