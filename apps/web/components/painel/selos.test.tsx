import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SeloEstado } from '@/components/conversas/lista'
import { SeloSimulacao } from './selo-simulacao'
import { SeloStatus } from './selo-status'

const etiqueta = (texto: string) => screen.getByText(texto).closest('[data-slot="etiqueta-status"]') as HTMLElement | null

describe('selos viram EtiquetaStatus sem mudar o texto', () => {
  it('Simulação', () => {
    render(<SeloSimulacao />)
    expect(etiqueta('Simulação')?.dataset.variante).toBe('simulacao')
  })
  it.each([
    ['novo', 'novo'], ['em_contato', 'em_contato'], ['confirmado', 'confirmado'], ['recusado', 'recusado'], ['cancelado', 'cancelado'],
  ] as const)('status de evento %s', (status, variante) => {
    const { container } = render(<SeloStatus status={status} />)
    expect(container.querySelector('[data-slot="etiqueta-status"]')?.getAttribute('data-variante')).toBe(variante)
  })
  it.each([
    ['aguardando_humano', 'aguarda'], ['humano', 'humano'], ['ia', 'ia'], ['encerrada', 'encerrada'],
  ] as const)('estado de conversa %s', (estado, variante) => {
    const { container } = render(<SeloEstado estado={estado} />)
    expect(container.querySelector('[data-slot="etiqueta-status"]')?.getAttribute('data-variante')).toBe(variante)
  })
})
