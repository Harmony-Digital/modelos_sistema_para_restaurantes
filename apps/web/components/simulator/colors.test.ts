import { describe, expect, it } from 'vitest'
import { contrastRatio } from '@/design/contrast'
import { WA } from './whatsapp-chat'

describe('cores do simulador (AA)', () => {
  it.each([
    ['texto no balão do cliente', WA.texto, WA.balaoCliente, 4.5],
    ['texto no balão do restaurante', WA.texto, WA.balaoRestaurante, 4.5],
    ['metadados no fundo', WA.meta, WA.fundo, 4.5],
    ['ícone no botão verde', WA.fundo, WA.verde, 3],
  ])('%s', (_n, a, b, min) => {
    expect(contrastRatio(a, b)).toBeGreaterThanOrEqual(min)
  })
})
