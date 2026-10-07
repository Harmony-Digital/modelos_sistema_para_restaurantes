import { describe, expect, it } from 'vitest'
import { cookieDoMenu, MENU_COOKIE, parseMenu } from './menu.ts'

describe('preferência do menu lateral', () => {
  it('padrão é aberto; só "recolhido" recolhe', () => {
    expect(MENU_COOKIE).toBe('atd_menu')
    expect(parseMenu(undefined)).toBe('aberto')
    expect(parseMenu('qualquer')).toBe('aberto')
    expect(parseMenu('aberto')).toBe('aberto')
    expect(parseMenu('recolhido')).toBe('recolhido')
  })
  it('cookie para o navegador gravar: caminho raiz, um ano, SameSite=Lax', () => {
    expect(cookieDoMenu('recolhido')).toBe('atd_menu=recolhido; path=/; max-age=31536000; samesite=lax')
    expect(cookieDoMenu('aberto')).toBe('atd_menu=aberto; path=/; max-age=31536000; samesite=lax')
  })
})
