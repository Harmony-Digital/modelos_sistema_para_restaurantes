import { describe, expect, it } from 'vitest'
import { emModoEconomico, mediaPorConversa, mesDaBusca, pctDoLimite, textoAlerta, ultimosMeses, usdParaCampo } from './gastos-tela'

const alerta = (over = {}) => ({
  escopo: 'ia' as const, periodo: 'dia' as const, nivel: 80 as const, inicioPeriodo: '2026-10-06', usoUsd: '1.640000', limiteUsd: '2.000000',
  criadoEm: new Date(), limiteAlteradoDepois: false, ...over,
})

describe('pctDoLimite', () => {
  it('arredonda para baixo (não diz 100% antes de chegar) e passa de 100', () => {
    expect(pctDoLimite('1.999999', '2')).toBe(99)
    expect(pctDoLimite('1.64', '2')).toBe(82)
    expect(pctDoLimite('3', '2')).toBe(150)
  })
  it('limite zero ou inválido não quebra a tela', () => {
    expect(pctDoLimite('1', '0')).toBe(100)
    expect(pctDoLimite('x', '2')).toBe(0)
  })
})

describe('textoAlerta', () => {
  it('diz o escopo, o percentual e o período', () => {
    expect(textoAlerta(alerta())).toBe('IA: 82% do limite do dia')
    expect(textoAlerta(alerta({ escopo: 'simulacao', periodo: 'mes', nivel: 100, usoUsd: '10.5', limiteUsd: '10' }))).toBe('Simulação: 105% do limite do mês')
    expect(textoAlerta(alerta({ escopo: 'whatsapp' }))).toBe('WhatsApp: 82% do limite do dia')
  })
  it('alerta de 100% nunca mostra menos que 100% (uso liquidado abaixo da reserva)', () => {
    expect(textoAlerta(alerta({ nivel: 100, usoUsd: '1.9' }))).toBe('IA: 100% do limite do dia')
    expect(emModoEconomico(alerta({ nivel: 100, usoUsd: '1.9' }))).toBe(true)
  })
  it('dono aumentou o limite depois do alerta de 100%: mostra o % atual e sai do modo econômico', () => {
    const a = alerta({ nivel: 100, usoUsd: '2', limiteUsd: '4', limiteAlteradoDepois: true })
    expect(textoAlerta(a)).toBe('IA: 50% do limite do dia')
    expect(emModoEconomico(a)).toBe(false)
    // aumentou, mas ainda abaixo do uso: continua parado
    const b = alerta({ nivel: 100, usoUsd: '2', limiteUsd: '1.5', limiteAlteradoDepois: true })
    expect(textoAlerta(b)).toBe('IA: 133% do limite do dia')
    expect(emModoEconomico(b)).toBe(true)
    expect(emModoEconomico(alerta())).toBe(false)
  })
})

describe('usdParaCampo', () => {
  it('numeric do banco vira texto do campo com vírgula, sem zeros sobrando', () => {
    expect(usdParaCampo('2.000000')).toBe('2,00')
    expect(usdParaCampo('0.123400')).toBe('0,1234')
    expect(usdParaCampo('40')).toBe('40,00')
    expect(usdParaCampo('5.5000')).toBe('5,50')
  })
})

describe('ultimosMeses', () => {
  it('12 meses no fuso do restaurante, do atual para trás, com nome em português', () => {
    // 01/10 02:00 UTC ainda é 30/09 em São Paulo
    const m = ultimosMeses(new Date('2026-10-01T02:00:00Z'), 'America/Sao_Paulo')
    expect(m).toHaveLength(12)
    expect(m[0]).toEqual({ valor: '2026-09', rotulo: 'setembro de 2026' })
    expect(m[11]).toEqual({ valor: '2025-10', rotulo: 'outubro de 2025' })
  })
})

describe('mediaPorConversa', () => {
  it('divide sem float; sem conversa = null', () => {
    expect(mediaPorConversa('1.200000', 4)).toBe('0.300000')
    expect(mediaPorConversa('1', 3)).toBe('0.333333')
    expect(mediaPorConversa('12', 1)).toBe('12.000000')
    expect(mediaPorConversa('1', 0)).toBeNull()
  })
})

describe('mesDaBusca', () => {
  const meses = ultimosMeses(new Date('2026-10-06T12:00:00Z'), 'America/Sao_Paulo')
  it('aceita só um dos 12 meses; senão, o atual', () => {
    expect(mesDaBusca('2026-03', meses)).toBe('2026-03')
    expect(mesDaBusca('2024-01', meses)).toBe('2026-10')
    expect(mesDaBusca(undefined, meses)).toBe('2026-10')
    expect(mesDaBusca(['2026-03'], meses)).toBe('2026-10')
  })
})
