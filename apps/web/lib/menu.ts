export const MENU_COOKIE = 'atd_menu'
export type EstadoMenu = 'aberto' | 'recolhido'

/** Lido no layout do servidor: o menu já nasce no estado certo, sem piscar. */
export function parseMenu(v: string | undefined): EstadoMenu {
  return v === 'recolhido' ? 'recolhido' : 'aberto'
}

/** Gravado pelo navegador ao recolher/abrir (preferência visual, não é dado sensível). */
export function cookieDoMenu(estado: EstadoMenu): string {
  return `${MENU_COOKIE}=${estado}; path=/; max-age=31536000; samesite=lax`
}
