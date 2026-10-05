import { describe, expect, it } from 'vitest'
import { agoraLocal, dataValida, diaDaSemana, diasEntre, partesDaData, somarDias } from './tempo.ts'

describe('tempo', () => {
  it('soma dias atravessando mês, ano e bissexto', () => {
    expect(somarDias('2026-10-31', 1)).toBe('2026-11-01')
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01')
    expect(somarDias('2028-02-28', 1)).toBe('2028-02-29')
    expect(somarDias('2026-10-05', -6)).toBe('2026-09-29')
  })
  it('dia da semana (0 = domingo)', () => {
    expect(diaDaSemana('2026-10-05')).toBe(1)
    expect(diaDaSemana('2026-10-11')).toBe(0)
    expect(diaDaSemana('2026-12-25')).toBe(5)
  })
  it('diferença em dias, validade e partes', () => {
    expect(diasEntre('2026-10-05', '2026-10-12')).toBe(7)
    expect(dataValida(2026, 2, 29)).toBe(false)
    expect(dataValida(2028, 2, 29)).toBe(true)
    expect(partesDaData('2026-10-05')).toEqual({ ano: 2026, mes: 10, dia: 5 })
  })
  it('agora no fuso do restaurante (meia-noite e madrugada)', () => {
    expect(agoraLocal(new Date('2026-10-10T04:00:00Z'), 'America/Sao_Paulo')).toEqual({ data: '2026-10-10', minuto: 60 })
    expect(agoraLocal(new Date('2026-10-10T02:30:00Z'), 'America/Sao_Paulo')).toEqual({ data: '2026-10-09', minuto: 1410 })
    expect(agoraLocal(new Date('2026-10-10T03:00:00Z'), 'America/Sao_Paulo')).toEqual({ data: '2026-10-10', minuto: 0 })
  })
  it('rejeita data mal formada', () => {
    expect(() => somarDias('10/05/2026', 1)).toThrow('Data inválida')
  })
})
