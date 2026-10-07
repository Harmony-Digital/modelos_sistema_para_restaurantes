import { describe, expect, it } from 'vitest'
import { contrastRatio } from './contrast.ts'
import { ALFA_FUNDO, CLASSE_TOM, misturar, paresEtiqueta, TOM_DA_VARIANTE, VARIANTES_ETIQUETA } from './etiquetas.ts'

describe('etiquetas de status', () => {
  it('mistura cor sobre fundo com alfa', () => {
    expect(misturar('#FFFFFF', '#000000', 0.5)).toBe('#808080')
    expect(misturar('#F28C1D', '#0F1322', 0)).toBe('#0f1322')
  })

  it('toda variante tem um tom', () => {
    for (const v of VARIANTES_ETIQUETA) expect(TOM_DA_VARIANTE[v]).toBeDefined()
    expect(TOM_DA_VARIANTE.aguarda).toBe('aviso')
    expect(TOM_DA_VARIANTE.ia).toBe('sucesso')
    expect(TOM_DA_VARIANTE.humano).toBe('info')
    expect(TOM_DA_VARIANTE.erro).toBe('destrutivo')
    expect(TOM_DA_VARIANTE.simulacao).toBe('neutro')
  })

  it('as classes usam o mesmo alfa que o teste de contraste mede', () => {
    for (const [tom, classe] of Object.entries(CLASSE_TOM)) {
      const t = tom as keyof typeof CLASSE_TOM
      expect(classe).toContain(`/${Math.round(ALFA_FUNDO.claro[t] * 100)} `)
      expect(classe).toContain(`dark:bg-`)
      expect(classe).toContain(`/${Math.round(ALFA_FUNDO.escuro[t] * 100)}`)
    }
  })

  for (const tema of ['escuro', 'claro'] as const) {
    for (const p of paresEtiqueta(tema)) {
      it(`${tema}: ${p.nome} ≥ 4.5:1`, () => {
        expect(contrastRatio(p.texto, p.fundo)).toBeGreaterThanOrEqual(4.5)
      })
    }
  }
})
