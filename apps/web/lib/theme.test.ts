import { describe, expect, it } from 'vitest'
import { dataThemeFor, parseTema } from './theme.ts'

describe('tema', () => {
  it('padrão é escuro', () => {
    expect(parseTema(undefined)).toBe('escuro')
    expect(parseTema('qualquer')).toBe('escuro')
  })
  it('respeita claro', () => {
    expect(parseTema('claro')).toBe('claro')
    expect(dataThemeFor('claro')).toBe('light')
    expect(dataThemeFor('escuro')).toBe('dark')
  })
})
