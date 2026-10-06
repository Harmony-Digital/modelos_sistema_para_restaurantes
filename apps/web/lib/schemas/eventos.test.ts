import { describe, expect, it } from 'vitest'
import { pedidoSchema } from './eventos'

const U = '00000000-0000-4000-8000-000000000001'

describe('pedidoSchema', () => {
  it('aceita status, responsável (ou ninguém) e notas aparadas', () => {
    expect(pedidoSchema.parse({ status: 'em_contato', responsavelId: U, notasInternas: '  ligar às 10h ' })).toEqual({ status: 'em_contato', responsavelId: U, notasInternas: 'ligar às 10h' })
    expect(pedidoSchema.safeParse({ status: 'novo', responsavelId: '', notasInternas: '' }).success).toBe(true)
  })
  it('recusa notas acima de 2000, status inválido e responsável que não é id', () => {
    const r = pedidoSchema.safeParse({ status: 'novo', responsavelId: '', notasInternas: 'x'.repeat(2001) })
    expect(r.success ? '' : r.error.issues[0]!.message).toBe('Use no máximo 2000 caracteres')
    expect(pedidoSchema.safeParse({ status: 'novo', responsavelId: '', notasInternas: 'x'.repeat(2000) }).success).toBe(true)
    expect(pedidoSchema.safeParse({ status: 'reservado', responsavelId: '', notasInternas: '' }).success).toBe(false)
    expect(pedidoSchema.safeParse({ status: 'novo', responsavelId: 'ana', notasInternas: '' }).success).toBe(false)
  })
})
