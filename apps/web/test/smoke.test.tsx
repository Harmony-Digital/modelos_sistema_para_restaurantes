import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

describe('ambiente de UI', () => {
  it('renderiza JSX no jsdom com jest-dom', () => {
    render(<button aria-pressed="false">Olá</button>)
    expect(screen.getByRole('button', { name: 'Olá' })).toHaveAttribute('aria-pressed', 'false')
  })
})
