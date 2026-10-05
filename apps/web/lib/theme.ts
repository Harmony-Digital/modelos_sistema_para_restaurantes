export const THEME_COOKIE = 'atd-tema'
export type Tema = 'escuro' | 'claro'

export function parseTema(v: string | undefined): Tema {
  return v === 'claro' ? 'claro' : 'escuro'
}

export function dataThemeFor(t: Tema): 'dark' | 'light' {
  return t === 'claro' ? 'light' : 'dark'
}
