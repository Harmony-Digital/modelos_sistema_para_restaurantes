import { describe, expect, it } from 'vitest'
import { excecoesCadastradas, feriadosComComportamento } from './feriados-unidade'

const SEG = new Date('2026-10-05T14:00:00-03:00')
const semanal = [[{ abre: '11:30', fecha: '16:00' }], [], [], [], [], [{ abre: '11:00', fecha: '23:00' }], []]
const u = { semanal, excecoes: { '2026-12-25': { fechado: true, turnos: [], motivo: 'Natal em família' } } }

describe('feriados e exceções da unidade', () => {
  it('lista os próximos feriados com o comportamento que a IA vai responder', () => {
    const lista = feriadosComComportamento(u, 'como_domingo', 'America/Sao_Paulo', SEG, 90)
    expect(lista.map((d) => [d.dataBr, d.feriado, d.comportamento, d.temExcecao])).toEqual([
      ['12/10/2026', 'Nossa Senhora Aparecida', 'Abre das 11h30 às 16h', false],
      ['02/11/2026', 'Finados', 'Abre das 11h30 às 16h', false],
      ['15/11/2026', 'Proclamação da República', 'Abre das 11h30 às 16h', false],
      ['20/11/2026', 'Dia Nacional de Zumbi e da Consciência Negra', 'Abre das 11h30 às 16h', false],
      ['25/12/2026', 'Natal', 'Fechada', true],
      ['01/01/2027', 'Confraternização Universal', 'Abre das 11h30 às 16h', false],
    ])
    expect(lista[0]!.rotulo).toBe('Segunda-feira, 12/10/2026')
    expect(feriadosComComportamento(u, 'fechado', 'America/Sao_Paulo', SEG, 10)[0]!.comportamento).toBe('Fechada')
  })

  it('exceções cadastradas de hoje em diante', () => {
    expect(excecoesCadastradas(u, 'America/Sao_Paulo', SEG)).toEqual([
      { data: '2026-12-25', dataBr: '25/12/2026', rotulo: 'Sexta-feira, 25/12/2026', feriado: 'Natal', comportamento: 'Fechada', temExcecao: true, motivo: 'Natal em família' },
    ])
  })
})
