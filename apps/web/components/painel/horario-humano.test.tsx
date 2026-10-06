import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HorarioHumano } from './horario-humano'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const vazio = { dom: [], seg: [], ter: [], qua: [], qui: [], sex: [], sab: [] }
const acao = vi.fn()

describe('HorarioHumano', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    acao.mockResolvedValue({ ok: true, data: null })
  })

  it('vazio salva e explica que a IA não promete horário', async () => {
    const user = userEvent.setup()
    render(<HorarioHumano inicial={{ dias: vazio }} acao={acao} />)
    expect(screen.getByText(/sem prometer um horário/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Salvar horário' }))
    expect(acao).toHaveBeenCalledWith({ dias: vazio })
  })

  it('turno com horário incompleto não chama a ação', async () => {
    const user = userEvent.setup()
    render(<HorarioHumano inicial={{ dias: vazio }} acao={acao} />)
    await user.click(screen.getAllByRole('button', { name: 'Adicionar turno' })[0]!)
    await user.click(screen.getByRole('button', { name: 'Salvar horário' }))
    expect(acao).not.toHaveBeenCalled()
  })

  it('válido: envia o turno', async () => {
    const user = userEvent.setup()
    render(<HorarioHumano inicial={{ dias: { ...vazio, seg: [{ inicio: '09:00', fim: '18:00' }] } }} acao={acao} />)
    await user.click(screen.getByRole('button', { name: 'Salvar horário' }))
    expect(acao).toHaveBeenCalledWith({ dias: { ...vazio, seg: [{ inicio: '09:00', fim: '18:00' }] } })
  })

  it('somente leitura: sem botões de edição', () => {
    render(<HorarioHumano inicial={{ dias: vazio }} acao={acao} somenteLeitura />)
    expect(screen.queryByRole('button', { name: 'Salvar horário' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Adicionar turno' })).toBeNull()
  })
})
