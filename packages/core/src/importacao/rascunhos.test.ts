import { describe, expect, it } from 'vitest'
import {
  LIMITES_IMPORTACAO,
  rascunhoCardapioImportacaoSchema,
  rascunhoEspacosSchema,
  rascunhoHorariosSchema,
  rascunhoInformacoesSchema,
  rascunhoSoPrecosSchema,
} from './index.ts'

const fato = (o: Record<string, unknown> = {}) => ({ tema: 'Estacionamento', texto: 'Temos manobrista.', exemplos: [], unidade: null, ...o })
const espaco = (o: Record<string, unknown> = {}) => ({
  nome: 'Salão VIP', unidade: 'Centro', capacidadeMin: 10, capacidadeMax: 40, descricao: null, condicoes: null, ...o,
})
const unidadeHorario = (o: Record<string, unknown> = {}) => ({
  unidade: 'Centro',
  semana: [{ dia: 1, turnos: [{ abre: '11:00', fecha: '15:00' }] }],
  excecoes: [],
  ...o,
})

describe('rascunhoInformacoesSchema', () => {
  it('aceita fatos válidos, apara espaços e põe incluir = true por padrão', () => {
    const r = rascunhoInformacoesSchema.parse({ fatos: [fato({ tema: ' Estacionamento ' })] })
    expect(r.fatos[0]).toMatchObject({ tema: 'Estacionamento', incluir: true, unidade: null })
  })
  it('limites: tema ≤ 120, texto ≤ 1000, exemplos ≤ 5 × 120, unidade ≤ 80', () => {
    const ok = (f: Record<string, unknown>) => rascunhoInformacoesSchema.safeParse({ fatos: [fato(f)] }).success
    expect(ok({ tema: 'x'.repeat(120) })).toBe(true)
    expect(ok({ tema: 'x'.repeat(121) })).toBe(false)
    expect(ok({ tema: '  ' })).toBe(false)
    expect(ok({ texto: 'x'.repeat(1000) })).toBe(true)
    expect(ok({ texto: 'x'.repeat(1001) })).toBe(false)
    expect(ok({ texto: '' })).toBe(false)
    expect(ok({ exemplos: Array(5).fill('x'.repeat(120)) })).toBe(true)
    expect(ok({ exemplos: Array(6).fill('a') })).toBe(false)
    expect(ok({ exemplos: ['x'.repeat(121)] })).toBe(false)
    expect(ok({ unidade: 'x'.repeat(81) })).toBe(false)
  })
  it(`no máximo ${LIMITES_IMPORTACAO.fatos} fatos`, () => {
    expect(rascunhoInformacoesSchema.safeParse({ fatos: Array(100).fill(fato()) }).success).toBe(true)
    expect(rascunhoInformacoesSchema.safeParse({ fatos: Array(101).fill(fato()) }).success).toBe(false)
  })
})

describe('rascunhoHorariosSchema', () => {
  const ok = (u: Record<string, unknown>) => rascunhoHorariosSchema.safeParse({ unidades: [unidadeHorario(u)] }).success
  it('aceita semana e exceções válidas (madrugada permitida) com padrões', () => {
    const r = rascunhoHorariosSchema.parse({
      unidades: [unidadeHorario({
        unidade: null,
        semana: [{ dia: 5, turnos: [{ abre: '18:00', fecha: '02:00' }] }],
        excecoes: [{ data: '2026-12-25', fechado: true, turnos: [], motivo: 'Natal' }],
      })],
    })
    expect(r.unidades[0]).toMatchObject({ unidade: null, incluir: true })
    expect(r.unidades[0]!.semana[0]!.conflito).toBe(false)
    expect(r.unidades[0]!.excecoes[0]!.conflito).toBe(false)
  })
  it('dia 0–6, até 6 turnos, HH:mm, abre ≠ fecha', () => {
    expect(ok({ semana: [{ dia: 0, turnos: [] }] })).toBe(true)
    expect(ok({ semana: [{ dia: 7, turnos: [] }] })).toBe(false)
    expect(ok({ semana: [{ dia: -1, turnos: [] }] })).toBe(false)
    const t = (abre: string, fecha: string) => ({ abre, fecha })
    expect(ok({ semana: [{ dia: 1, turnos: Array(6).fill(t('10:00', '11:00')) }] })).toBe(true)
    expect(ok({ semana: [{ dia: 1, turnos: Array(7).fill(t('10:00', '11:00')) }] })).toBe(false)
    expect(ok({ semana: [{ dia: 1, turnos: [t('24:00', '11:00')] }] })).toBe(false)
    expect(ok({ semana: [{ dia: 1, turnos: [t('9:00', '11:00')] }] })).toBe(false)
    expect(ok({ semana: [{ dia: 1, turnos: [t('10:00', '10:00')] }] })).toBe(false)
  })
  it('dia repetido na semana é recusado', () => {
    expect(ok({ semana: [{ dia: 1, turnos: [] }, { dia: 1, turnos: [] }] })).toBe(false)
  })
  it('exceção: data ISO real, fechado sem turnos ou aberto com turnos, motivo ≤ 120', () => {
    const ex = (o: Record<string, unknown>) =>
      ok({ excecoes: [{ data: '2026-12-24', fechado: false, turnos: [{ abre: '11:00', fecha: '15:00' }], motivo: null, ...o }] })
    expect(ex({})).toBe(true)
    expect(ex({ data: '24/12/2026' })).toBe(false)
    expect(ex({ data: '2026-02-30' })).toBe(false)
    expect(ex({ data: '2026-13-01' })).toBe(false)
    expect(ex({ fechado: true })).toBe(false)
    expect(ex({ fechado: false, turnos: [] })).toBe(false)
    expect(ex({ fechado: true, turnos: [] })).toBe(true)
    expect(ex({ motivo: 'x'.repeat(120) })).toBe(true)
    expect(ex({ motivo: 'x'.repeat(121) })).toBe(false)
  })
  it('data repetida nas exceções é recusada', () => {
    const e = { data: '2026-12-25', fechado: true, turnos: [], motivo: null }
    expect(ok({ excecoes: [e, e] })).toBe(false)
  })
})

describe('rascunhoEspacosSchema', () => {
  const ok = (o: Record<string, unknown>) => rascunhoEspacosSchema.safeParse({ espacos: [espaco(o)] }).success
  it('aceita um espaço válido com incluir = true por padrão', () => {
    expect(rascunhoEspacosSchema.parse({ espacos: [espaco()] }).espacos[0]!.incluir).toBe(true)
  })
  it('capacidades inteiras 1–1000 com mínimo ≤ máximo', () => {
    expect(ok({ capacidadeMin: 1, capacidadeMax: 1000 })).toBe(true)
    expect(ok({ capacidadeMin: 20, capacidadeMax: 20 })).toBe(true)
    expect(ok({ capacidadeMin: 0 })).toBe(false)
    expect(ok({ capacidadeMax: 1001 })).toBe(false)
    expect(ok({ capacidadeMin: 10.5 })).toBe(false)
    expect(ok({ capacidadeMin: 50, capacidadeMax: 40 })).toBe(false)
  })
  it('nome obrigatório ≤ 80', () => {
    expect(ok({ nome: ' ' })).toBe(false)
    expect(ok({ nome: 'x'.repeat(81) })).toBe(false)
  })
})

describe('rascunhoSoPrecosSchema', () => {
  const item = (o: Record<string, unknown> = {}) => ({ nome: 'Picanha', categoria: null, precoCentavos: 5990, ...o })
  it('aceita item com preço ou sem preço (null) e incluir padrão', () => {
    const r = rascunhoSoPrecosSchema.parse({ itens: [item(), item({ nome: 'Fraldinha', precoCentavos: null, categoria: 'Carnes' })] })
    expect(r.itens.map((i) => i.incluir)).toEqual([true, true])
    expect(r.itens[1]!.precoCentavos).toBeNull()
  })
  it('preço inteiro 0..10 000 000', () => {
    expect(rascunhoSoPrecosSchema.safeParse({ itens: [item({ precoCentavos: -1 })] }).success).toBe(false)
    expect(rascunhoSoPrecosSchema.safeParse({ itens: [item({ precoCentavos: 1.5 })] }).success).toBe(false)
    expect(rascunhoSoPrecosSchema.safeParse({ itens: [item({ precoCentavos: 10_000_001 })] }).success).toBe(false)
  })
})

describe('rascunhoCardapioImportacaoSchema', () => {
  it('aceita o rascunho da Etapa 05 e o conflito de preço opcional', () => {
    const item = { nome: 'Picanha', descricao: null, precoCentavos: 5990, tags: [], outrosNomes: [], unidade: null, incluir: true }
    expect(rascunhoCardapioImportacaoSchema.safeParse({ categorias: [{ nome: 'Carnes', itens: [item] }] }).success).toBe(true)
    expect(
      rascunhoCardapioImportacaoSchema.safeParse({ categorias: [{ nome: 'Carnes', itens: [{ ...item, precoConflito: [5990, 6490] }] }] }).success,
    ).toBe(true)
    expect(
      rascunhoCardapioImportacaoSchema.safeParse({ categorias: [{ nome: 'Carnes', itens: [{ ...item, precoConflito: [-1] }] }] }).success,
    ).toBe(false)
  })
})
