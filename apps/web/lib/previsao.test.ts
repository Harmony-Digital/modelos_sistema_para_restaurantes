import { describe, expect, it } from 'vitest'
import { dataDaUrl, hrefPrevisao, resumoUnidade, rotuloDoDia, validarAvisoNaUnidade } from './previsao'

const jantar = { abre: '18:00', fecha: '23:00' }
const SEG_MEIO_DIA = { data: '2026-10-05', minuto: 12 * 60 }
const unidade = { semanal: [[], [], [jantar], [jantar], [jantar], [jantar], [jantar]], excecoes: {} }

describe('previsão: datas e links', () => {
  it('data da URL: inválida volta para hoje; fora de hoje ± 30 vai para o limite', () => {
    expect(dataDaUrl(undefined, '2026-10-05')).toBe('2026-10-05')
    expect(dataDaUrl('lixo', '2026-10-05')).toBe('2026-10-05')
    expect(dataDaUrl('2026-10-12', '2026-10-05')).toBe('2026-10-12')
    expect(dataDaUrl('2026-09-20', '2026-10-05')).toBe('2026-09-20')
    expect(dataDaUrl('2026-09-01', '2026-10-05')).toBe('2026-09-05')
    expect(dataDaUrl('2027-01-01', '2026-10-05')).toBe('2026-11-04')
  })
  it('href omite o que é padrão', () => {
    expect(hrefPrevisao({ data: '2026-10-05', hoje: '2026-10-05' })).toBe('/agenda?aba=previsao')
    expect(hrefPrevisao({ data: '2026-10-06', hoje: '2026-10-05', unidade: 'u1', cancelados: true })).toBe('/agenda?aba=previsao&data=2026-10-06&unidade=u1&cancelados=1')
  })
  it('rótulo do dia em dd/mm/aaaa', () => {
    expect(rotuloDoDia('2026-10-05', '2026-10-05')).toBe('Hoje · Segunda-feira, 05/10/2026')
    expect(rotuloDoDia('2026-10-06', '2026-10-05')).toBe('Terça-feira, 06/10/2026')
  })
  it('resumo da unidade conta só ativos e usa singular', () => {
    const av = (status: 'ativo' | 'cancelado', pessoas: number) => ({ id: String(Math.random()), unitId: 'u', nome: null, pessoas, horarioAprox: null, origem: 'ia' as const, status })
    expect(resumoUnidade({ unitId: 'u', unidade: 'A', totalPessoas: 1, avisos: [av('ativo', 1)] })).toEqual({ pessoas: '1 pessoa', avisos: '1 aviso' })
    expect(resumoUnidade({ unitId: 'u', unidade: 'A', totalPessoas: 5, avisos: [av('ativo', 5), av('cancelado', 3), av('ativo', 0)] })).toEqual({ pessoas: '5 pessoas', avisos: '2 avisos' })
    expect(resumoUnidade({ unitId: 'u', unidade: 'A', totalPessoas: 0, avisos: [] })).toEqual({ pessoas: '0 pessoas', avisos: '0 avisos' })
  })
})

describe('validarAvisoNaUnidade', () => {
  it('ok, fechada (campo data) e horário fora (campo horario com turnos)', () => {
    expect(validarAvisoNaUnidade(unidade, '2026-10-06', '20:00', 'como_domingo', SEG_MEIO_DIA)).toBeNull()
    expect(validarAvisoNaUnidade(unidade, '2026-10-05', '', 'como_domingo', SEG_MEIO_DIA)).toEqual({ data: 'A unidade não abre nesse dia.' })
    expect(validarAvisoNaUnidade(unidade, '2026-10-06', '12:00', 'como_domingo', SEG_MEIO_DIA)).toEqual({ horario: 'Nesse dia a unidade funciona das 18h às 23h.' })
  })
  it('hoje num horário que já passou (campo horario)', () => {
    const terca21h = { data: '2026-10-06', minuto: 21 * 60 }
    expect(validarAvisoNaUnidade(unidade, '2026-10-06', '20:00', 'normal', terca21h)).toEqual({ horario: 'Esse horário de hoje já passou.' })
    expect(validarAvisoNaUnidade(unidade, '2026-10-06', '22:00', 'normal', terca21h)).toBeNull()
    expect(validarAvisoNaUnidade(unidade, '2026-10-06', '', 'normal', terca21h)).toBeNull()
  })
  it('feriado como domingo (fechado) usa o mapa nacional', () => {
    expect(validarAvisoNaUnidade(unidade, '2026-12-25', '', 'como_domingo', SEG_MEIO_DIA)).toEqual({ data: 'A unidade não abre nesse dia.' })
    expect(validarAvisoNaUnidade(unidade, '2026-12-25', '', 'normal', SEG_MEIO_DIA)).toBeNull()
  })
})
