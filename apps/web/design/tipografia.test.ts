import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ler = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')

describe('identidade operacional', () => {
  const css = ler('../app/globals.css')
  const layout = ler('../app/layout.tsx')

  it('fontes IBM Plex Sans e Mono pelo next/font, sem Sora/DM Sans/JetBrains', () => {
    expect(layout).toMatch(/IBM_Plex_Sans\b/)
    expect(layout).toMatch(/IBM_Plex_Mono\b/)
    expect(layout).not.toMatch(/Sora|DM_Sans|JetBrains/)
    expect(css).not.toMatch(/font-sora|font-dm-sans|font-jetbrains/)
  })
  it('tokens de tipografia apontam para as variáveis do Plex', () => {
    expect(css).toMatch(/--font-sans:\s*var\(--font-plex-sans\)/)
    expect(css).toMatch(/--font-display:\s*var\(--font-plex-sans\)/)
    expect(css).toMatch(/--font-mono:\s*var\(--font-plex-mono\)/)
  })
  it('raio menor: cartões 8 px, botões 6 px', () => {
    expect(css).toMatch(/--radius:\s*8px/)
    expect(css).toMatch(/--radius-md:\s*6px/)
    expect(css).toMatch(/--radius-lg:\s*var\(--radius\)/)
    expect(css).toMatch(/--radius-xl:\s*var\(--radius\)/)
  })
})
