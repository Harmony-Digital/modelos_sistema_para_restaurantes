import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { HorariosForm } from './horarios-form'

const vazia = () => ({ semanal: [[], [], [], [], [], [], []] as { abre: string; fecha: string }[][] })

describe('HorariosForm', () => {
  it('erro de turno aparece no dia certo e não envia', async () => {
    const user = userEvent.setup()
    const acao = vi.fn()
    render(<HorariosForm unitId="u" inicial={vazia()} acao={acao} />)
    const segunda = screen.getByRole('group', { name: 'Segunda-feira' })
    await user.click(within(segunda).getByRole('button', { name: 'Adicionar turno' }))
    await user.type(within(segunda).getByLabelText(/^Abre/), '1100')
    await user.type(within(segunda).getByLabelText(/^Fecha/), '1100')
    await user.click(screen.getByRole('button', { name: 'Salvar horários' }))
    expect(await within(segunda).findByText('Turno 1: a abertura e o fechamento não podem ser iguais.')).toBeInTheDocument()
    expect(acao).not.toHaveBeenCalled()
  })

  it('copia a segunda para os dias úteis, avisa a madrugada e envia a semana', async () => {
    const user = userEvent.setup()
    const acao = vi.fn().mockResolvedValue({ ok: true, data: null })
    render(<HorariosForm unitId="u" inicial={vazia()} acao={acao} />)
    const segunda = screen.getByRole('group', { name: 'Segunda-feira' })
    await user.click(within(segunda).getByRole('button', { name: 'Adicionar turno' }))
    await user.type(within(segunda).getByLabelText(/^Abre/), '1800')
    await user.type(within(segunda).getByLabelText(/^Fecha/), '0200')
    expect(within(segunda).getByText('Termina no dia seguinte (madrugada).')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Copiar segunda para dias úteis' }))
    expect(within(screen.getByRole('group', { name: 'Sexta-feira' })).getByLabelText(/^Abre/)).toHaveValue('18:00')
    expect(within(screen.getByRole('group', { name: 'Sábado' })).queryByLabelText(/^Abre/)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Salvar horários' }))
    expect(acao).toHaveBeenCalledOnce()
    const enviada = acao.mock.calls[0]![0].semanal
    expect(enviada[1]).toEqual([{ abre: '18:00', fecha: '02:00' }])
    expect(enviada[5]).toEqual([{ abre: '18:00', fecha: '02:00' }])
    expect(enviada[6]).toEqual([])
  })
})
