import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { contrastRatio } from './contrast.ts'
import { themeColorFor } from '../lib/theme.ts'
import { contrastPairs, themes, type ThemeTokens } from './tokens.ts'

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

  describe('globals.css em sincronia com os tokens', () => {
    const css = readFileSync(fileURLToPath(new URL('../app/globals.css', import.meta.url)), 'utf8')
    const parseBlock = (selector: RegExp) => {
      const m = selector.exec(css)
      if (!m) throw new Error(`bloco não encontrado: ${selector}`)
      return Object.fromEntries([...m[1]!.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((x) => [x[1]!, x[2]!.trim().toLowerCase()]))
    }
    const blocks = {
      escuro: parseBlock(/:root,\s*\[data-theme="dark"\]\s*\{([^}]*)\}/),
      claro: parseBlock(/\[data-theme="light"\]\s*\{([^}]*)\}/),
    }
    const varOf: Record<keyof ThemeTokens, string> = {
      background: '--background', foreground: '--foreground', card: '--card', muted: '--muted',
      mutedForeground: '--muted-foreground', primary: '--primary', primaryForeground: '--primary-foreground',
      secondary: '--secondary', destructive: '--destructive', destructiveForeground: '--destructive-foreground',
      border: '--border', input: '--input', ring: '--ring', link: '--link', success: '--success',
      warning: '--warning', info: '--info',
    }
    for (const tema of ['escuro', 'claro'] as const) {
      it(`${tema}: cada token está na variável CSS correta`, () => {
        for (const [token, cssVar] of Object.entries(varOf)) {
          expect(blocks[tema][cssVar], `${tema} ${cssVar}`).toBe(themes[tema][token as keyof ThemeTokens].toLowerCase())
        }
        expect(blocks[tema]['--card-foreground']).toBe(blocks[tema]['--foreground'])
        expect(blocks[tema]['--popover-foreground']).toBe(blocks[tema]['--foreground'])
        expect(blocks[tema]['--popover']).toBe(blocks[tema]['--card'])
      })
      it(`${tema}: themeColor do navegador é o fundo`, () => {
        expect(themeColorFor(tema).toLowerCase()).toBe(blocks[tema]['--background'])
      })
    }
  })
})
