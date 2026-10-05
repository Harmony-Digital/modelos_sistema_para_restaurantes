import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { contrastRatio } from './contrast.ts'
import { contrastPairs, themes } from './tokens.ts'

describe('contraste WCAG', () => {
  it('fórmula confere com valores conhecidos', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1)
    expect(contrastRatio('#151A2D', '#F28C1D')).toBeCloseTo(7.02, 1)
  })

  for (const tema of ['escuro', 'claro'] as const) {
    for (const p of contrastPairs(tema)) {
      it(`${tema}: ${p.nome} ≥ ${p.minimo}:1`, () => {
        expect(contrastRatio(p.texto, p.fundo)).toBeGreaterThanOrEqual(p.minimo)
      })
    }
  }

  it('globals.css usa exatamente os hex dos tokens', () => {
    const css = readFileSync(fileURLToPath(new URL('../app/globals.css', import.meta.url)), 'utf8').toLowerCase()
    for (const tema of Object.values(themes)) {
      for (const hex of Object.values(tema)) expect(css).toContain(hex.toLowerCase())
    }
  })
})
