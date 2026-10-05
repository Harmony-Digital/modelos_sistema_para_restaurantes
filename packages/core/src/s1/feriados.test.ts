import { describe, expect, it } from 'vitest'
import { feriadosNacionais, mapaFeriados, pascoa } from './feriados.ts'

describe('feriados nacionais', () => {
  it('Páscoa conferida com datas oficiais', () => {
    expect(pascoa(2024)).toBe('2024-03-31')
    expect(pascoa(2025)).toBe('2025-04-20')
    expect(pascoa(2026)).toBe('2026-04-05')
    expect(pascoa(2027)).toBe('2027-03-28')
  })
  it('2026: fixos + móveis (Carnaval, Sexta-feira Santa, Corpus Christi), em ordem', () => {
    expect(feriadosNacionais(2026)).toEqual([
      { data: '2026-01-01', nome: 'Confraternização Universal' },
      { data: '2026-02-16', nome: 'Carnaval' },
      { data: '2026-02-17', nome: 'Carnaval' },
      { data: '2026-04-03', nome: 'Sexta-feira Santa' },
      { data: '2026-04-21', nome: 'Tiradentes' },
      { data: '2026-05-01', nome: 'Dia do Trabalho' },
      { data: '2026-06-04', nome: 'Corpus Christi' },
      { data: '2026-09-07', nome: 'Independência do Brasil' },
      { data: '2026-10-12', nome: 'Nossa Senhora Aparecida' },
      { data: '2026-11-02', nome: 'Finados' },
      { data: '2026-11-15', nome: 'Proclamação da República' },
      { data: '2026-11-20', nome: 'Dia Nacional de Zumbi e da Consciência Negra' },
      { data: '2026-12-25', nome: 'Natal' },
    ])
  })
  it('2025 e 2027: móveis', () => {
    const d25 = feriadosNacionais(2025).map((f) => f.data)
    expect(d25).toEqual(expect.arrayContaining(['2025-03-03', '2025-03-04', '2025-04-18', '2025-06-19']))
    const d27 = feriadosNacionais(2027).map((f) => f.data)
    expect(d27).toEqual(expect.arrayContaining(['2027-02-08', '2027-02-09', '2027-03-26', '2027-05-27']))
  })
  it('Consciência Negra é nacional a partir de 2024 (Lei 14.759/2023)', () => {
    expect(feriadosNacionais(2023).some((f) => f.data === '2023-11-20')).toBe(false)
    expect(feriadosNacionais(2024).some((f) => f.data === '2024-11-20')).toBe(true)
  })
  it('mapa data → nome', () => {
    expect(mapaFeriados(feriadosNacionais(2026)).get('2026-12-25')).toBe('Natal')
  })
})
