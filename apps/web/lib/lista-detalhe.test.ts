import { describe, expect, it } from 'vitest'
import { buscaDaLista, colunaDetalhe, colunaLista, hrefLista } from './lista-detalhe'

describe('colunas da lista + detalhe', () => {
  it('< lg: só a lista sem detalhe aberto; só o detalhe com detalhe aberto. lg+: as duas', () => {
    expect(colunaLista(false).split(' ')).toContain('flex')
    expect(colunaLista(true).split(' ')).toContain('hidden')
    expect(colunaDetalhe(false).split(' ')).toContain('hidden')
    expect(colunaDetalhe(true).split(' ')).toContain('flex')
    for (const c of [colunaLista(true), colunaLista(false), colunaDetalhe(true), colunaDetalhe(false)]) {
      expect(c.split(' ')).toContain('lg:flex')
      // rolagem própria em cada coluna e nada corta entre 1024 e 1280 px
      expect(c.split(' ')).toContain('lg:overflow-y-auto')
      expect(c.split(' ')).toContain('min-w-0')
    }
    expect(colunaLista(false)).toMatch(/lg:w-\[/)
    expect(colunaDetalhe(false)).toMatch(/lg:min-w-\[/)
  })
})

describe('buscaDaLista / hrefLista', () => {
  it('mantém só os filtros da lista (aba, unidade, simulações, página) e descarta o resto', () => {
    expect(buscaDaLista({ aba: 'ia', unidade: 'u1', sim: '1', cursor: 'c', antes: '9', x: 'y' })).toBe('aba=ia&unidade=u1&sim=1&cursor=c')
    expect(buscaDaLista({})).toBe('')
    expect(buscaDaLista({ aba: ['ia', 'x'] as unknown as string })).toBe('')
  })
  it('monta o endereço da lista ou do item com os filtros', () => {
    expect(hrefLista('/conversas', {})).toBe('/conversas')
    expect(hrefLista('/conversas', { aba: 'ia', antes: '3' })).toBe('/conversas?aba=ia')
    expect(hrefLista('/conversas/abc', { aba: 'ia' }, { antes: '7' })).toBe('/conversas/abc?aba=ia&antes=7')
  })
})
