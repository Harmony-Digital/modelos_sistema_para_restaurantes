import { describe, expect, it } from 'vitest'
import { rotuloDoDia, validarAvisoNaUnidade } from './previsao'

const jantar = { abre: '18:00', fecha: '23:00' }
const SEG_MEIO_DIA = { data: '2026-10-05', minuto: 12 * 60 }
const unidade = { semanal: [[], [], [jantar], [jantar], [jantar], [jantar], [jantar]], excecoes: {} }

describe('previsão: datas', () => {
  it('rótulo do dia em dd/mm/aaaa', () => {
    expect(rotuloDoDia('2026-10-05', '2026-10-05')).toBe('Hoje · Segunda-feira, 05/10/2026')
    expect(rotuloDoDia('2026-10-06', '2026-10-05')).toBe('Terça-feira, 06/10/2026')
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
