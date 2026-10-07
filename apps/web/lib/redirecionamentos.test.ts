import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { REDIRECIONAMENTOS } from './redirecionamentos.ts'

/** Aplica a primeira regra que casa (como o Next): `:resto*` casa zero ou mais segmentos. */
function destino(caminho: string): string | undefined {
  for (const r of REDIRECIONAMENTOS) {
    const re = new RegExp('^' + r.source.replace(/\/:\w+\*/g, '(?:/.*)?') + '$')
    if (re.test(caminho)) return r.destination
  }
  return undefined
}

describe('endereços antigos do painel', () => {
  it('todos permanentes', () => {
    expect(REDIRECIONAMENTOS.length).toBeGreaterThan(0)
    for (const r of REDIRECIONAMENTOS) expect(r.permanent).toBe(true)
  })
  it.each([
    ['/mais', '/ajustes'],
    ['/mais/atendimento-humano', '/ajustes#atendimento-humano'],
    ['/mais/gastos', '/gestao/gastos'],
    ['/mais/equipe', '/gestao/equipe'],
    ['/mais/privacidade', '/gestao/privacidade'],
    ['/mais/qualquer/coisa', '/ajustes'],
  ])('%s → %s', (de, para) => {
    expect(destino(de)).toBe(para)
  })
  it('não mexe em rotas que não são de /mais (inclusive /privacidade pública e /maisX)', () => {
    expect(destino('/privacidade')).toBeUndefined()
    expect(destino('/maisX')).toBeUndefined()
    expect(destino('/gestao/gastos')).toBeUndefined()
  })
  it('todo destino é uma página que existe', () => {
    const app = fileURLToPath(new URL('../app/(painel)', import.meta.url))
    for (const r of REDIRECIONAMENTOS) expect(existsSync(`${app}${r.destination.split('#')[0]}/page.tsx`), r.destination).toBe(true)
  })
})
