import { describe, expect, it } from 'vitest'
import { ESTADOS_CONVERSA, HANDOFF_MOTIVOS, podeTransicionar, TRANSICOES_CONVERSA } from './index.ts'

describe('transições da conversa', () => {
  it('motivos de handoff', () => {
    expect(HANDOFF_MOTIVOS).toEqual(['pedido', 'frustracao', 'falhas', 'economico', 'servico'])
  })
  it('todo estado tem a sua lista', () => {
    expect(Object.keys(TRANSICOES_CONVERSA).sort()).toEqual([...ESTADOS_CONVERSA].sort())
  })
  it('assumir: de ia e aguardando_humano (e de humano só como "assumir mesmo assim")', () => {
    expect(podeTransicionar('ia', 'humano')).toBe(true)
    expect(podeTransicionar('aguardando_humano', 'humano')).toBe(true)
    expect(podeTransicionar('humano', 'humano')).toBe(true)
    expect(podeTransicionar('encerrada', 'humano')).toBe(false)
  })
  it('devolver à IA: de aguardando_humano e humano', () => {
    expect(podeTransicionar('aguardando_humano', 'ia')).toBe(true)
    expect(podeTransicionar('humano', 'ia')).toBe(true)
    expect(podeTransicionar('ia', 'ia')).toBe(false)
    expect(podeTransicionar('encerrada', 'ia')).toBe(false)
  })
  it('encerrar: de qualquer estado não encerrado; encerrada é final', () => {
    for (const e of ['ia', 'aguardando_humano', 'humano'] as const) expect(podeTransicionar(e, 'encerrada'), e).toBe(true)
    expect(TRANSICOES_CONVERSA.encerrada).toEqual([])
  })
  it('handoff: só da IA', () => {
    expect(podeTransicionar('ia', 'aguardando_humano')).toBe(true)
    expect(podeTransicionar('humano', 'aguardando_humano')).toBe(false)
    expect(podeTransicionar('encerrada', 'aguardando_humano')).toBe(false)
  })
})
