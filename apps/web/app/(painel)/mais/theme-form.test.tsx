import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ThemeForm } from './theme-form'

describe('ThemeForm', () => {
  it('mostra o tema atual marcado e envia a troca', async () => {
    const user = userEvent.setup()
    const action = vi.fn(async (_fd: FormData) => {})
    render(<ThemeForm atual="escuro" action={action} />)
    expect(screen.getByRole('radio', { name: /Escuro/ })).toBeChecked()
    await user.click(screen.getByRole('radio', { name: /Claro/ }))
    expect(action).toHaveBeenCalledTimes(1)
    expect(action.mock.calls[0]![0].get('tema')).toBe('claro')
  })
})
