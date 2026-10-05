import { themes } from '../design/tokens.ts'

export const THEME_COOKIE = 'atd-tema'
export type Tema = 'escuro' | 'claro'

export function parseTema(v: string | undefined): Tema {
  return v === 'claro' ? 'claro' : 'escuro'
}

export function dataThemeFor(t: Tema): 'dark' | 'light' {
  return t === 'claro' ? 'light' : 'dark'
}

/** Cor da barra do navegador: o fundo do tema. */
export function themeColorFor(t: Tema): string {
  return themes[t].background
}
