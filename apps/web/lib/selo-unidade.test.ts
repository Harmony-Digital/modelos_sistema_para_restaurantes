import { describe, expect, it } from 'vitest'
import { seloDaUnidade } from './selo-unidade'

const SEG_14H = new Date('2026-10-05T14:00:00-03:00')
const todo = (abre: string, fecha: string) => Array.from({ length: 7 }, () => [{ abre, fecha }])
const u = (semanal: { abre: string; fecha: string }[][], ativo = true) => ({ ativo, semanal, excecoes: {} })

describe('seloDaUnidade', () => {
  it('aberta, fechada com próxima abertura, sem horário e desativada', () => {
    expect(seloDaUnidade(u(todo('11:00', '23:00')), 'como_domingo', 'America/Sao_Paulo', SEG_14H))
      .toEqual({ tom: 'aberta', texto: 'Aberta agora · fecha às 23h' })
    const semSegunda = todo('11:30', '15:00')
    semSegunda[1] = []
    expect(seloDaUnidade(u(semSegunda), 'como_domingo', 'America/Sao_Paulo', SEG_14H))
      .toEqual({ tom: 'fechada', texto: 'Fechada · abre amanhã às 11h30' })
    expect(seloDaUnidade(u([[], [], [], [], [], [], []]), 'como_domingo', 'America/Sao_Paulo', SEG_14H))
      .toEqual({ tom: 'alerta', texto: 'Horário não cadastrado' })
    expect(seloDaUnidade(u(todo('11:00', '23:00'), false), 'como_domingo', 'America/Sao_Paulo', SEG_14H))
      .toEqual({ tom: 'alerta', texto: 'Desativada' })
    expect(seloDaUnidade(u(todo('00:00', '23:59')), 'como_domingo', 'America/Sao_Paulo', SEG_14H))
      .toEqual({ tom: 'aberta', texto: 'Aberta agora · fecha às 23h59' })
  })
})
