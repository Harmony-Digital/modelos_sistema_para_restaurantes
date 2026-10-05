import { describe, expect, it } from 'vitest'
import { resolverData } from './datas.ts'
import { feriadosNacionais } from './feriados.ts'

const hoje = '2026-10-05' // segunda-feira
const fer = [...feriadosNacionais(2026), ...feriadosNacionais(2027)]
const r = (t: string | null, h = hoje) => resolverData(t, h, fer)
const ok = (data: string) => ({ ok: true, data })

describe('resolverData', () => {
  it('vazio, hoje, amanhã, depois de amanhã', () => {
    expect(r(null)).toEqual(ok('2026-10-05'))
    expect(r('hoje à noite')).toEqual(ok('2026-10-05'))
    expect(r('amanhã')).toEqual(ok('2026-10-06'))
    expect(r('depois de amanhã')).toEqual(ok('2026-10-07'))
  })
  it('dia da semana: próxima ocorrência, hoje incluído', () => {
    expect(r('domingo')).toEqual(ok('2026-10-11'))
    expect(r('segunda')).toEqual(ok('2026-10-05'))
    expect(r('sexta-feira')).toEqual(ok('2026-10-09'))
    expect(r('sábado que vem')).toEqual(ok('2026-10-10'))
    expect(r('fim de semana')).toEqual(ok('2026-10-10'))
    expect(r('dmg')).toEqual(ok('2026-10-11'))
    expect(r('sab')).toEqual(ok('2026-10-10'))
  })
  it('dia do mês: próxima ocorrência válida', () => {
    expect(r('dia 12')).toEqual(ok('2026-10-12'))
    expect(r('12')).toEqual(ok('2026-10-12'))
    expect(r('dia 3')).toEqual(ok('2026-11-03'))
    expect(r('dia 31', '2026-11-05')).toEqual(ok('2026-12-31'))
    expect(r('dia 40')).toEqual({ ok: false })
  })
  it('dd/mm, dd/mm/aaaa e por extenso', () => {
    expect(r('12/10')).toEqual(ok('2026-10-12'))
    expect(r('01/01')).toEqual(ok('2027-01-01'))
    expect(r('25/12/2026')).toEqual(ok('2026-12-25'))
    expect(r('31/02')).toEqual({ ok: false })
    expect(r('12 de outubro')).toEqual(ok('2026-10-12'))
  })
  it('feriados por nome e "no feriado"', () => {
    expect(r('no feriado')).toEqual(ok('2026-10-12'))
    expect(r('natal')).toEqual(ok('2026-12-25'))
    expect(r('carnaval')).toEqual(ok('2027-02-08'))
    expect(r('sexta-feira santa')).toEqual(ok('2027-03-26'))
    expect(r('primeiro de maio')).toEqual(ok('2027-05-01'))
  })
  it('não inventa: o que não entende é ok=false', () => {
    expect(r('semana retrasada')).toEqual({ ok: false })
    expect(r('ontem')).toEqual({ ok: false })
  })
  it('ISO, números dentro de números e data por extenso com ano', () => {
    expect(r('2026-10-12')).toEqual(ok('2026-10-12'))
    expect(r('2026-02-30')).toEqual({ ok: false })
    expect(r('12/10')).toEqual(ok('2026-10-12'))
    expect(r('12 de outubro de 2027')).toEqual(ok('2027-10-12'))
  })
  it('dia da semana: nomes completos no texto, abreviação só sozinha', () => {
    expect(r('vai ter música sábado')).toEqual(ok('2026-10-10'))
    expect(r('dmg')).toEqual(ok('2026-10-11'))
    expect(r('sab')).toEqual(ok('2026-10-10'))
    expect(r('no sab')).toEqual(ok('2026-10-10'))
    expect(r('ter')).toEqual({ ok: false })
    expect(r('terça')).toEqual(ok('2026-10-06'))
  })
  it('fim de semana a partir de sábado ou domingo é hoje', () => {
    expect(r('fim de semana', '2026-10-11')).toEqual(ok('2026-10-11'))
    expect(r('fim de semana', '2026-10-10')).toEqual(ok('2026-10-10'))
  })
})
