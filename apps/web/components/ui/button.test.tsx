import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button } from './button'

describe('Button', () => {
  it('primário usa fundo laranja com texto navy e altura de toque de 44px', () => {
    render(<Button>Salvar</Button>)
    const b = screen.getByRole('button', { name: 'Salvar' })
    expect(b.className).toMatch(/bg-primary/)
    expect(b.className).toMatch(/text-primary-foreground/)
    expect(b.className).toMatch(/h-11/)
  })
  it('ícone tem 44×44', () => {
    render(<Button size="icon" aria-label="Fechar">x</Button>)
    expect(screen.getByRole('button', { name: 'Fechar' }).className).toMatch(/size-11/)
  })
})
