import { describe, expect, it } from 'vitest'
import {
  asHora, dasHora, formatarEndereco, formatarHora, formatarTurnos, quandoAbre, renderModelo, rotuloDoDia, validarModelo,
} from './modelos.ts'

const hoje = '2026-10-05'

describe('horas', () => {
  it('formata como se fala', () => {
    expect(formatarHora('11:30')).toBe('11h30')
    expect(formatarHora('18:00')).toBe('18h')
    expect(formatarHora('08:00')).toBe('8h')
    expect(formatarHora('00:00')).toBe('meia-noite')
    expect(asHora('23:00')).toBe('às 23h')
    expect(asHora('00:00')).toBe('à meia-noite')
    expect(asHora('01:30')).toBe('à 1h30')
    expect(asHora('02:00')).toBe('às 2h')
    expect(dasHora('00:00')).toBe('da meia-noite')
    expect(dasHora('01:00')).toBe('da 1h')
    expect(dasHora('11:00')).toBe('das 11h')
  })
  it('turnos', () => {
    expect(formatarTurnos([])).toBe('')
    expect(formatarTurnos([{ abre: '11:00', fecha: '23:00' }])).toBe('das 11h às 23h')
    expect(formatarTurnos([{ abre: '11:30', fecha: '15:00' }, { abre: '18:00', fecha: '23:00' }])).toBe('das 11h30 às 15h e das 18h às 23h')
    expect(formatarTurnos([{ abre: '08:00', fecha: '10:00' }, { abre: '11:00', fecha: '14:00' }, { abre: '18:00', fecha: '00:00' }]))
      .toBe('das 8h às 10h, das 11h às 14h e das 18h à meia-noite')
  })
})

describe('dias', () => {
  it('rótulo do dia (início de frase)', () => {
    expect(rotuloDoDia('2026-10-05', hoje, null)).toBe('Hoje')
    expect(rotuloDoDia('2026-10-06', hoje, null)).toBe('Amanhã')
    expect(rotuloDoDia('2026-10-11', hoje, null)).toBe('Domingo (11/10)')
    expect(rotuloDoDia('2026-10-12', hoje, 'Nossa Senhora Aparecida')).toBe('Segunda-feira (12/10, Nossa Senhora Aparecida)')
    expect(rotuloDoDia('2026-10-05', hoje, 'Natal')).toBe('Hoje (Natal)')
  })
  it('quando abre (meio de frase, com artigo)', () => {
    expect(quandoAbre('2026-10-05', hoje)).toBe('hoje')
    expect(quandoAbre('2026-10-06', hoje)).toBe('amanhã')
    expect(quandoAbre('2026-10-10', hoje)).toBe('no sábado (10/10)')
    expect(quandoAbre('2026-10-11', hoje)).toBe('no domingo (11/10)')
    expect(quandoAbre('2026-10-07', hoje)).toBe('na quarta-feira (07/10)')
  })
})

describe('modelos', () => {
  it('renderiza o padrão e o personalizado', () => {
    expect(renderModelo('aberto_sim', { unidade: 'Asa Sul', fecha: 'às 23h' })).toBe('A unidade Asa Sul está aberta agora e fecha às 23h.')
    expect(renderModelo('aberto_sim', { unidade: 'Asa Sul', fecha: 'às 23h' }, { aberto_sim: 'Sim! {unidade} até {fecha}.' }))
      .toBe('Sim! Asa Sul até às 23h.')
  })
  it('valor de variável não é reinterpretado', () => {
    expect(renderModelo('aberto_sim', { unidade: '{fecha}', fecha: 'às 23h' })).toBe('A unidade {fecha} está aberta agora e fecha às 23h.')
  })
  it('valida variáveis, vazio e tamanho', () => {
    expect(validarModelo('aberto_sim', 'Aberta: {unidade} até {fecha}')).toBeNull()
    expect(validarModelo('aberto_sim', 'Aberta {unidade} {xyz}')).toBe('A variável {xyz} não existe neste modelo. Use: {unidade}, {fecha}.')
    expect(validarModelo('lacuna', 'Vou ver {unidade}')).toBe('A variável {unidade} não existe neste modelo. Este modelo não usa variáveis.')
    expect(validarModelo('lacuna', '   ')).toBe('Escreva o texto do modelo.')
    expect(validarModelo('lacuna', 'x'.repeat(1001))).toBe('Use no máximo 1000 caracteres.')
  })
})

describe('endereço', () => {
  it('junta as partes cadastradas', () => {
    expect(formatarEndereco({ endereco: 'SCLS 404 Bloco C', bairro: 'Asa Sul', cidade: 'Brasília', uf: 'DF' }))
      .toBe('SCLS 404 Bloco C, Asa Sul, Brasília/DF')
    expect(formatarEndereco({ endereco: 'Rua 1', bairro: null, cidade: 'Goiânia', uf: null })).toBe('Rua 1, Goiânia')
    expect(formatarEndereco({ endereco: null, bairro: 'Centro', cidade: 'Brasília', uf: 'DF' })).toBeNull()
  })
})
