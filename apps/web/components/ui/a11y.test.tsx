import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Badge } from './badge'
import { Button } from './button'
import { Card } from './card'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog'
import { EtiquetaStatus } from './etiqueta-status'
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
    expect(screen.getByRole('switch').className).toMatch(/after:-inset-x-3/)
    expect(screen.getByRole('switch').className).toMatch(/after:-inset-y-4/)
  })
  it('Card tem borda de 1 px e raio de cartão (rounded-lg = 8 px); Button usa rounded-md (6 px)', () => {
    render(<><Card>c</Card><Button>b</Button></>)
    const card = screen.getByText('c').className
    expect(card).toMatch(/(^| )border( |$)/)
    expect(card).toMatch(/rounded-lg/)
    expect(card).not.toMatch(/rounded-xl|shadow-sm/)
    expect(screen.getByRole('button', { name: 'b' }).className).toMatch(/rounded-md/)
  })
  it('EtiquetaStatus de erro usa a cor destrutiva como texto, nunca branco', () => {
    render(<EtiquetaStatus variante="erro">Falhou</EtiquetaStatus>)
    const c = screen.getByText('Falhou').className
    expect(c).toMatch(/text-destructive( |$)/)
    expect(c).not.toMatch(/text-white/)
  })
})
