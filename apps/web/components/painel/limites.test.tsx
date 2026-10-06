import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Limites } from './limites'

const limites = [
  { id: '1', escopo: 'ia' as const, periodo: 'dia' as const, limiteUsd: '2.000000', alertaPct: 80 },
  { id: '2', escopo: 'ia' as const, periodo: 'mes' as const, limiteUsd: '40.000000', alertaPct: 80 },
  { id: '3', escopo: 'simulacao' as const, periodo: 'dia' as const, limiteUsd: '1.000000', alertaPct: 80 },
  { id: '4', escopo: 'simulacao' as const, periodo: 'mes' as const, limiteUsd: '10.000000', alertaPct: 80 },
  { id: '5', escopo: 'whatsapp' as const, periodo: 'dia' as const, limiteUsd: '1.000000', alertaPct: 80 },
  { id: '6', escopo: 'whatsapp' as const, periodo: 'mes' as const, limiteUsd: '20.000000', alertaPct: 80 },
]
const uso = {
  hoje: { ia: '1.640000', simulacao: '0', whatsapp: '0.100000' },
  mes: { ia: '12.000000', simulacao: '0.500000', whatsapp: '1.000000' },
}

function montar(over: Partial<Parameters<typeof Limites>[0]> = {}) {
  const acoes = {
    salvarLimite: vi.fn().mockResolvedValue({ ok: true, data: null }),
    salvarCotacao: vi.fn().mockResolvedValue({ ok: true, data: null }),
  }
  render(<Limites limites={limites} uso={uso} cotacao="5.0000" acoes={acoes} {...over} />)
  return acoes
}

describe('Limites', () => {
  it('um grupo por tipo de gasto (IA, simulação, WhatsApp), com dia e mês, uso em US$ e R$ e o %', () => {
    montar()
    const ia = screen.getByRole('group', { name: 'IA (clientes)' })
    expect(within(ia).getByLabelText(/^Limite do dia/)).toHaveValue('2,00')
    expect(within(ia).getByLabelText(/^Limite do mês/)).toHaveValue('40,00')
    expect(within(ia).getByText('Usado hoje: US$ 1,64 · R$ 8,20 (82%)')).toBeInTheDocument()
    expect(within(ia).getByText('Usado no mês: US$ 12,00 · R$ 60,00 (30%)')).toBeInTheDocument()
    const sim = screen.getByRole('group', { name: 'Simulação' })
    expect(within(sim).getByText(/não afeta os clientes/)).toBeInTheDocument()
    expect(within(sim).getByLabelText(/^Limite do mês/)).toHaveValue('10,00')
    expect(screen.getByRole('group', { name: 'WhatsApp' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^Cotação do dólar/)).toHaveValue('5,00')
  })

  it('o dono salva um limite com vírgula', async () => {
    const user = userEvent.setup()
    const acoes = montar()
    const ia = screen.getByRole('group', { name: 'IA (clientes)' })
    const campo = within(ia).getByLabelText(/^Limite do dia/)
    await user.clear(campo)
    await user.type(campo, '3,5')
    const alerta = within(ia).getByLabelText(/^Avisar no dia em/)
    await user.clear(alerta)
    await user.type(alerta, '90')
    await user.click(within(ia).getByRole('button', { name: 'Salvar limite do dia' }))
    expect(acoes.salvarLimite).toHaveBeenCalledWith({ escopo: 'ia', periodo: 'dia', limiteUsd: '3,5', alertaPct: '90' })
  })

  it('valida antes de enviar: zero, acima de 10.000 e alerta fora de 1–100', async () => {
    const user = userEvent.setup()
    const acoes = montar()
    const wa = screen.getByRole('group', { name: 'WhatsApp' })
    const campo = within(wa).getByLabelText(/^Limite do mês/)
    await user.clear(campo)
    await user.type(campo, '0')
    await user.click(within(wa).getByRole('button', { name: 'Salvar limite do mês' }))
    expect(await within(wa).findByText('O limite precisa ser maior que zero')).toBeInTheDocument()
    await user.clear(campo)
    await user.type(campo, '20000')
    const alerta = within(wa).getByLabelText(/^Avisar no mês em/)
    await user.clear(alerta)
    await user.type(alerta, '150')
    await user.click(within(wa).getByRole('button', { name: 'Salvar limite do mês' }))
    expect(await within(wa).findByText('Use no máximo US$ 10.000')).toBeInTheDocument()
    expect(within(wa).getByText('Use um número de 1 a 100')).toBeInTheDocument()
    expect(acoes.salvarLimite).not.toHaveBeenCalled()
  })

  it('o dono salva a cotação', async () => {
    const user = userEvent.setup()
    const acoes = montar()
    const campo = screen.getByLabelText(/^Cotação do dólar/)
    await user.clear(campo)
    await user.type(campo, '5,43')
    await user.click(screen.getByRole('button', { name: 'Salvar cotação' }))
    expect(acoes.salvarCotacao).toHaveBeenCalledWith({ cotacao: '5,43' })
  })

  it('gerente só vê: campos desabilitados e sem botões', () => {
    montar({ somenteLeitura: true })
    expect(screen.getAllByRole('textbox').every((c) => (c as HTMLInputElement).disabled)).toBe(true)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.getByText(/Só o dono altera/)).toBeInTheDocument()
  })

  it('erro do servidor aparece no formulário certo', async () => {
    const user = userEvent.setup()
    const acoes = montar()
    acoes.salvarLimite.mockResolvedValue({ ok: false, formError: 'Você não tem permissão para fazer essa alteração.' })
    const sim = screen.getByRole('group', { name: 'Simulação' })
    await user.click(within(sim).getByRole('button', { name: 'Salvar limite do dia' }))
    expect(await within(sim).findByRole('alert')).toHaveTextContent('Você não tem permissão para fazer essa alteração.')
  })
})
