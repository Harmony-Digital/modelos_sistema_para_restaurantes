import { describe, expect, it } from 'vitest'
import { resolverS1 } from '@atd/core'
import { CASOS } from './casos.ts'
import { horasInventadas } from './comparar.ts'
import { CONTEXTO, CONTEXTO_PEQUENO } from './fixture.ts'

describe('evals S1 — camada 2 (resolução + composição, determinística)', () => {
  it('gabarito tem pelo menos 80 casos, ids únicos', () => {
    expect(CASOS.length).toBeGreaterThanOrEqual(80)
    expect(new Set(CASOS.map((c) => c.id)).size).toBe(CASOS.length)
  })

  for (const caso of CASOS) {
    it(`${caso.id}: ${caso.mensagem}`, () => {
      const ctx = caso.contexto === 'pequeno' ? CONTEXTO_PEQUENO : CONTEXTO
      const r = resolverS1(caso.itens, ctx, new Date(caso.agora))
      const e = caso.espera
      if (e.texto !== undefined) expect(r.texto).toBe(e.texto)
      for (const t of e.contem ?? []) expect(r.texto).toContain(t)
      for (const t of e.naoContem ?? []) expect(r.texto ?? '').not.toContain(t)
      expect(r.lista !== null).toBe(e.lista ?? false)
      if (e.localizacoes !== undefined) expect(r.localizacoes).toHaveLength(e.localizacoes)
      expect(r.lacunas.map((l) => l.chave)).toEqual(e.lacunas ?? [])
      expect(horasInventadas(r.texto ?? '', ctx)).toEqual([]) // meta: 0 horário inexistente
      expect(r).toMatchSnapshot()
    })
  }
})
