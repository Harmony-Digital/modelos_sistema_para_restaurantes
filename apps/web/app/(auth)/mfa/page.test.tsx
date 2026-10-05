import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mfa = vi.hoisted(() => ({
  listFactors: vi.fn(),
  unenroll: vi.fn(),
  enroll: vi.fn(),
  challenge: vi.fn(),
  verify: vi.fn(),
}))
const replace = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { mfa } }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh: vi.fn() }) }))

import MfaPage from './page'

beforeEach(() => {
  Object.values(mfa).forEach((m) => m.mockReset())
  replace.mockReset()
  mfa.listFactors.mockResolvedValue({ data: { totp: [{ id: 'f1', status: 'verified' }], all: [] }, error: null })
  mfa.challenge.mockResolvedValue({ data: { id: 'c1' }, error: null })
})

async function abrir() {
  render(<MfaPage />)
  return screen.findByLabelText(/Código de 6 dígitos/)
}

describe('MfaPage', () => {
  it('código incompleto: erro no campo, foco e nenhuma chamada ao Supabase', async () => {
    const user = userEvent.setup()
    const campo = await abrir()
    await user.type(campo, '123')
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(campo).toHaveAccessibleDescription(/Digite os 6 dígitos/)
    expect(campo).toHaveFocus()
    expect(mfa.challenge).not.toHaveBeenCalled()
    expect(mfa.verify).not.toHaveBeenCalled()
  })

  it('máscara mantém só dígitos, no máximo 6', async () => {
    const user = userEvent.setup()
    const campo = await abrir()
    await user.type(campo, '1a2b3-4 5678')
    expect(campo).toHaveValue('123456')
  })

  it('código errado: erro no campo com foco', async () => {
    const user = userEvent.setup()
    mfa.verify.mockResolvedValue({ error: { message: 'bad' } })
    const campo = await abrir()
    await user.type(campo, '123456')
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(campo).toHaveAccessibleDescription(/Código inválido ou expirado/))
    expect(campo).toHaveFocus()
    expect(replace).not.toHaveBeenCalled()
  })

  it('código certo navega para o painel', async () => {
    const user = userEvent.setup()
    mfa.verify.mockResolvedValue({ error: null })
    const campo = await abrir()
    await user.type(campo, '123456')
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'))
    expect(mfa.verify).toHaveBeenCalledWith({ factorId: 'f1', challengeId: 'c1', code: '123456' })
  })
})
