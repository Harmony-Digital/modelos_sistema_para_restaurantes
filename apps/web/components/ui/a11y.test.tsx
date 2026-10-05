import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Badge } from './badge'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog'
import { Switch } from './switch'

describe('acessibilidade dos primitivos', () => {
  it('fechar do Dialog tem nome "Fechar" e alvo de 44px', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Título</DialogTitle>
          <DialogDescription>Descrição</DialogDescription>
        </DialogContent>
      </Dialog>,
    )
    expect(screen.getByRole('button', { name: 'Fechar' }).className).toMatch(/size-11/)
  })
  it('Badge destructive usa texto destructive-foreground, nunca branco', () => {
    render(<Badge variant="destructive">x</Badge>)
    const c = screen.getByText('x').className
    expect(c).toMatch(/text-destructive-foreground/)
    expect(c).not.toMatch(/text-white/)
  })
  it('Badge link usa text-link', () => {
    render(<Badge variant="link">l</Badge>)
    expect(screen.getByText('l').className).toMatch(/text-link/)
  })
  it('Switch tem área de toque ampliada', () => {
    render(<Switch aria-label="Ativo" />)
    expect(screen.getByRole('switch').className).toMatch(/after:-inset-3/)
  })
})
