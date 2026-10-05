export type ThemeTokens = {
  background: string; foreground: string; card: string; muted: string; mutedForeground: string
  primary: string; primaryForeground: string; secondary: string; destructive: string; destructiveForeground: string
  border: string; input: string; ring: string; link: string; success: string; warning: string; info: string
}

export const themes: Record<'escuro' | 'claro', ThemeTokens> = {
  escuro: {
    background: '#0F1322', foreground: '#C9CCD6', card: '#1A2036', muted: '#151A2D', mutedForeground: '#8E94A6',
    primary: '#F28C1D', primaryForeground: '#151A2D', secondary: '#2B3040', destructive: '#F87171',
    destructiveForeground: '#0F1322', border: '#2B3040', input: '#6B7186', ring: '#F28C1D', link: '#F7B265',
    success: '#4ADE80', warning: '#FBBF24', info: '#7DB3F5',
  },
  claro: {
    background: '#FAF8F4', foreground: '#151A2D', card: '#FFFEFB', muted: '#F3F0EA', mutedForeground: '#4A5061',
    primary: '#F28C1D', primaryForeground: '#151A2D', secondary: '#F3F0EA', destructive: '#B42318',
    destructiveForeground: '#FFFFFF', border: '#E7E2D9', input: '#8A8377', ring: '#9E5306', link: '#9E5306',
    success: '#1F7A4D', warning: '#8A5A00', info: '#1D4E89',
  },
}

export function contrastPairs(tema: 'escuro' | 'claro') {
  const t = themes[tema]
  const texto = (nome: string, a: string, b: string) => ({ nome, texto: a, fundo: b, minimo: 4.5 as const })
  const ui = (nome: string, a: string, b: string) => ({ nome, texto: a, fundo: b, minimo: 3 as const })
  return [
    texto('texto/fundo', t.foreground, t.background),
    texto('texto/cartão', t.foreground, t.card),
    texto('secundário/fundo', t.mutedForeground, t.background),
    texto('secundário/cartão', t.mutedForeground, t.card),
    texto('texto do botão primário', t.primaryForeground, t.primary),
    texto('texto/botão secundário', t.foreground, t.secondary),
    texto('texto do botão destrutivo', t.destructiveForeground, t.destructive),
    texto('erro/cartão', t.destructive, t.card),
    texto('link/fundo', t.link, t.background),
    texto('link/cartão', t.link, t.card),
    texto('sucesso/cartão', t.success, t.card),
    texto('aviso/cartão', t.warning, t.card),
    texto('info/cartão', t.info, t.card),
    ui('borda de controle/fundo', t.input, t.background),
    ui('borda de controle/cartão', t.input, t.card),
    ui('foco/fundo', t.ring, t.background),
    ui('foco/cartão', t.ring, t.card),
  ]
}
