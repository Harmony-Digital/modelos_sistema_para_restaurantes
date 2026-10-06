import { describe, expect, it } from 'vitest'
import { resolverAtendimento } from '@atd/core'
import { CASOS, FRASES } from './casos.ts'
import { horasInventadasS2 } from './comparar.ts'
import { CONTEXTO, CONTEXTO_PEQUENO } from './fixture.ts'

describe('evals S2 — camada 2 (resolução + composição, determinística)', () => {
  it('gabarito tem pelo menos 40 casos e 30 frases, ids únicos', () => {
    expect(CASOS.length).toBeGreaterThanOrEqual(40)
    expect(FRASES.length).toBeGreaterThanOrEqual(30)
    expect(new Set(CASOS.map((c) => c.id)).size).toBe(CASOS.length)
    expect(new Set(FRASES.map((c) => c.id)).size).toBe(FRASES.length)
  })

  for (const caso of CASOS) {
    it(`${caso.id}: ${caso.mensagem}`, () => {
      const ctx = caso.contexto === 'pequeno' ? CONTEXTO_PEQUENO : CONTEXTO
      const r = resolverAtendimento(caso.itens, ctx, new Date(caso.agora), caso.avisos ?? [], caso.escolhida)
      const e = caso.espera
      if (e.texto !== undefined) expect(r.texto).toBe(e.texto)
      for (const t of e.contem ?? []) expect(r.texto).toContain(t)
      for (const t of e.naoContem ?? []) expect(r.texto ?? '').not.toContain(t)
      expect(r.acoesS2).toEqual(e.acoes ?? [])
      expect(r.perguntarPessoas !== null).toBe(e.pergunta ?? false)
      expect(r.lista !== null).toBe(e.lista ?? false)
      expect(horasInventadasS2(r.texto ?? '', ctx, caso.itens)).toEqual([]) // meta: 0 horário inexistente
      expect(r).toMatchSnapshot()
    })
  }
})
