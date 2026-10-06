import { describe, expect, it } from 'vitest'
import { STATUS_PEDIDO_EVENTO, TRANSICOES_PEDIDO_EVENTO } from './index.ts'

describe('status do pedido de evento', () => {
  it('espelha o enum `event_status` do banco, na ordem do ciclo', () => {
    expect(STATUS_PEDIDO_EVENTO).toEqual(['novo', 'em_contato', 'confirmado', 'recusado', 'cancelado'])
  })
  it('transições: só para a frente; recusado e cancelado são finais', () => {
    expect(TRANSICOES_PEDIDO_EVENTO).toEqual({
      novo: ['em_contato', 'confirmado', 'recusado', 'cancelado'],
      em_contato: ['confirmado', 'recusado', 'cancelado'],
      confirmado: ['cancelado'],
      recusado: [],
      cancelado: [],
    })
  })
})
