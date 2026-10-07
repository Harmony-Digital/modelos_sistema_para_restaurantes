import { describe, expect, it } from 'vitest'
import {
  juntarCardapio,
  juntarEspacos,
  juntarHorarios,
  juntarInformacoes,
  juntarSoPrecos,
  rascunhoCardapioImportacaoSchema,
  rascunhoEspacosSchema,
  rascunhoHorariosSchema,
  rascunhoInformacoesSchema,
  type RascunhoCardapioImportacao,
  type RascunhoEspacos,
  type RascunhoHorarios,
  type RascunhoInformacoes,
  type RascunhoSoPrecos,
} from './index.ts'

type ItemC = RascunhoCardapioImportacao['categorias'][number]['itens'][number]
const itemC = (o: Partial<ItemC> = {}): ItemC => ({
  nome: 'Picanha', descricao: null, precoCentavos: 5990, tags: [], outrosNomes: [], unidade: null, incluir: true, ...o,
})
const cardapio = (...cats: [string, ItemC[]][]): RascunhoCardapioImportacao => ({
  categorias: cats.map(([nome, itens]) => ({ nome, itens })),
})

describe('juntarCardapio', () => {
  it('sem acumulado devolve o lote (deduplicado)', () => {
    const a = cardapio(['Carnes', [itemC(), itemC({ nome: 'Fraldinha', precoCentavos: 4990 })]])
    expect(juntarCardapio(null, a)).toEqual(a)
  })

  it('categorias e itens com nome parecido (acento, caixa, espaços) viram um só', () => {
    const a = cardapio(['Bebidas', [itemC({ nome: 'Água com gás', precoCentavos: 600 })]])
    const b = cardapio([' bebidas ', [itemC({ nome: 'agua  com GAS', precoCentavos: 600 }), itemC({ nome: 'Suco', precoCentavos: 900 })]])
    const r = juntarCardapio(a, b)
    expect(r.categorias).toHaveLength(1)
    expect(r.categorias[0]!.nome).toBe('Bebidas')
    expect(r.categorias[0]!.itens.map((i) => i.nome)).toEqual(['Água com gás', 'Suco'])
    expect(r.categorias[0]!.itens[0]!.precoConflito).toBeUndefined()
  })

  it('Review Focus 2: mesmo item em duas fotos com preços diferentes vira um item com conflito marcado', () => {
    const foto1 = cardapio(['Carnes', [itemC({ precoCentavos: 5990 })]])
    const foto2 = cardapio(['Carnes', [itemC({ precoCentavos: 6490 })]])
    const r = juntarCardapio(foto1, foto2)
    const itens = r.categorias.flatMap((c) => c.itens)
    expect(itens).toHaveLength(1)
    expect(itens[0]!.precoCentavos).toBe(5990) // mantém o primeiro
    expect(itens[0]!.precoConflito).toEqual([5990, 6490])
    expect(rascunhoCardapioImportacaoSchema.safeParse(r).success).toBe(true)
  })

  it('I1: itens homônimos em categorias diferentes continuam separados e sem conflito de preço', () => {
    const r = juntarCardapio(cardapio(['Grelhados', [itemC({ precoCentavos: 8900 })]]), cardapio(['Executivos', [itemC({ precoCentavos: 4900 })]]))
    expect(r.categorias.map((c) => [c.nome, c.itens.map((i) => [i.nome, i.precoCentavos, i.precoConflito])])).toEqual([
      ['Grelhados', [['Picanha', 8900, undefined]]],
      ['Executivos', [['Picanha', 4900, undefined]]],
    ])
  })

  it('I1: o mesmo vale dentro de um único lote (primeira leitura)', () => {
    const r = juntarCardapio(null, cardapio(['Grelhados', [itemC({ precoCentavos: 8900 })]], ['Executivos', [itemC({ precoCentavos: 4900 })]]))
    expect(r.categorias.flatMap((c) => c.itens)).toHaveLength(2)
    expect(r.categorias.flatMap((c) => c.itens).every((i) => i.precoConflito === undefined)).toBe(true)
  })

  it('I1: mesmo item na mesma categoria (nome normalizado) em lotes diferentes junta com conflito', () => {
    const r = juntarCardapio(cardapio(['Grelhados', [itemC({ precoCentavos: 8900 })]]), cardapio([' grelhados', [itemC({ nome: 'PICANHA', precoCentavos: 9900 })]]))
    expect(r.categorias).toHaveLength(1)
    expect(r.categorias[0]!.itens).toHaveLength(1)
    expect(r.categorias[0]!.itens[0]!.precoConflito).toEqual([8900, 9900])
  })

  it('itens com o mesmo nome em unidades diferentes continuam separados', () => {
    const r = juntarCardapio(
      cardapio(['Carnes', [itemC({ unidade: 'Centro' })]]),
      cardapio(['Carnes', [itemC({ unidade: 'Praia', precoCentavos: 6990 })]]),
    )
    expect(r.categorias[0]!.itens).toHaveLength(2)
    expect(r.categorias[0]!.itens.every((i) => i.precoConflito === undefined)).toBe(true)
  })

  it('preço ilegível (null) é preenchido pela outra foto sem conflito; descrição, tags e apelidos se completam', () => {
    const r = juntarCardapio(
      cardapio(['Carnes', [itemC({ precoCentavos: null, tags: ['grelhado'], outrosNomes: ['pica'] })]]),
      cardapio(['Carnes', [itemC({ precoCentavos: 6490, descricao: '400 g', tags: ['Grelhado', 'boi'], outrosNomes: ['Pica', 'picanha nobre'] })]]),
    )
    const i = r.categorias[0]!.itens[0]!
    expect(i.precoCentavos).toBe(6490)
    expect(i.precoConflito).toBeUndefined()
    expect(i.descricao).toBe('400 g')
    expect(i.tags).toEqual(['grelhado', 'boi'])
    expect(i.outrosNomes).toEqual(['pica', 'picanha nobre'])
  })

  it('três fotos com três preços acumulam o conflito sem repetir', () => {
    const f = (p: number) => cardapio(['Carnes', [itemC({ precoCentavos: p })]])
    const r = juntarCardapio(juntarCardapio(juntarCardapio(f(5990), f(6490)), f(5990)), f(6990))
    expect(r.categorias[0]!.itens[0]!.precoConflito).toEqual([5990, 6490, 6990])
  })

  it('é idempotente: juntar(a, a) = a, inclusive com conflito', () => {
    const a = juntarCardapio(cardapio(['Carnes', [itemC()]]), cardapio(['Carnes', [itemC({ precoCentavos: 6490 })]], ['Bebidas', [itemC({ nome: 'Suco' })]]))
    expect(juntarCardapio(a, a)).toEqual(a)
  })

  it('respeita os limites (500 itens no total)', () => {
    const muitos = (pref: string) => cardapio(['Tudo', Array.from({ length: 300 }, (_, k) => itemC({ nome: `${pref} ${k}` }))])
    const r = juntarCardapio(muitos('A'), muitos('B'))
    expect(r.categorias.reduce((n, c) => n + c.itens.length, 0)).toBe(500)
    expect(rascunhoCardapioImportacaoSchema.safeParse(r).success).toBe(true)
  })
})

describe('juntarSoPrecos', () => {
  const it_ = (o: Partial<RascunhoSoPrecos['itens'][number]> = {}) => ({ nome: 'Picanha', categoria: null, precoCentavos: 5990, incluir: true, ...o })
  it('dedupe por nome normalizado; categoria nula é completada', () => {
    const r = juntarSoPrecos({ itens: [it_()] }, { itens: [it_({ nome: 'PICANHA', categoria: 'Carnes' }), it_({ nome: 'Suco', precoCentavos: 900 })] })
    expect(r.itens).toEqual([it_({ categoria: 'Carnes' }), it_({ nome: 'Suco', precoCentavos: 900 })])
  })
  it('Review Focus 4: preço não lido (null) nunca apaga um preço lido', () => {
    const r = juntarSoPrecos({ itens: [it_({ precoCentavos: 5990 })] }, { itens: [it_({ precoCentavos: null })] })
    expect(r.itens[0]!.precoCentavos).toBe(5990)
    expect(r.itens[0]!.precoConflito).toBeUndefined()
    const s = juntarSoPrecos(null, { itens: [it_({ precoCentavos: null })] })
    expect(s.itens[0]!.precoCentavos).toBeNull()
  })
  it('preços diferentes marcam conflito', () => {
    const r = juntarSoPrecos({ itens: [it_()] }, { itens: [it_({ precoCentavos: 6490 })] })
    expect(r.itens).toHaveLength(1)
    expect(r.itens[0]!.precoConflito).toEqual([5990, 6490])
  })
  it('é idempotente', () => {
    const a = juntarSoPrecos({ itens: [it_()] }, { itens: [it_({ precoCentavos: 6490 }), it_({ nome: 'Suco', precoCentavos: null })] })
    expect(juntarSoPrecos(a, a)).toEqual(a)
  })
  it('I2: homônimos em categorias diferentes continuam separados, sem conflito (um lote só)', () => {
    const r = juntarSoPrecos(null, { itens: [it_({ categoria: 'Grelhados', precoCentavos: 8900 }), it_({ categoria: 'Executivos', precoCentavos: 4900 })] })
    expect(r.itens).toEqual([it_({ categoria: 'Grelhados', precoCentavos: 8900 }), it_({ categoria: 'Executivos', precoCentavos: 4900 })])
  })
  it('I2: homônimos em categorias diferentes em lotes diferentes também ficam separados', () => {
    const a = juntarSoPrecos(null, { itens: [it_({ categoria: 'Grelhados', precoCentavos: 8900 })] })
    const r = juntarSoPrecos(a, { itens: [it_({ categoria: 'executivos', precoCentavos: 4900 }), it_({ categoria: 'GRELHADOS', precoCentavos: 9100 })] })
    expect(r.itens).toEqual([
      { ...it_({ categoria: 'Grelhados', precoCentavos: 8900 }), precoConflito: [8900, 9100] },
      it_({ categoria: 'executivos', precoCentavos: 4900 }),
    ])
    expect(juntarSoPrecos(r, r)).toEqual(r)
  })
  it('I2: categoria não lida junta ao único item de mesmo nome; com dois homônimos fica à parte', () => {
    const um = juntarSoPrecos({ itens: [it_({ categoria: 'Grelhados' })] }, { itens: [it_({ categoria: null, precoCentavos: null })] })
    expect(um.itens).toEqual([it_({ categoria: 'Grelhados' })])
    const dois = juntarSoPrecos(
      { itens: [it_({ categoria: 'Grelhados', precoCentavos: 8900 }), it_({ categoria: 'Executivos', precoCentavos: 4900 })] },
      { itens: [it_({ categoria: null, precoCentavos: 5000 })] },
    )
    expect(dois.itens).toHaveLength(3)
    expect(dois.itens[2]).toEqual(it_({ categoria: null, precoCentavos: 5000 }))
    expect(juntarSoPrecos(dois, dois)).toEqual(dois)
  })
})

describe('juntarInformacoes', () => {
  const f = (o: Partial<RascunhoInformacoes['fatos'][number]> = {}) => ({
    tema: 'Estacionamento', texto: 'Temos manobrista.', exemplos: [] as string[], unidade: null, incluir: true, ...o,
  })
  it('junta por tema normalizado e unidade; textos diferentes se somam, exemplos sem repetir', () => {
    const r = juntarInformacoes(
      { fatos: [f({ exemplos: ['tem estacionamento?'] })] },
      { fatos: [f({ tema: 'estacionamento ', texto: 'Gratuito para clientes.', exemplos: ['Tem estacionamento?', 'onde paro?'] }), f({ unidade: 'Centro' })] },
    )
    expect(r.fatos).toHaveLength(2)
    expect(r.fatos[0]).toEqual(f({ texto: 'Temos manobrista.\nGratuito para clientes.', exemplos: ['tem estacionamento?', 'onde paro?'] }))
    expect(r.fatos[1]!.unidade).toBe('Centro')
  })
  it('o mesmo texto lido de novo não duplica', () => {
    const r = juntarInformacoes({ fatos: [f()] }, { fatos: [f({ texto: 'temos  manobrista' })] })
    expect(r.fatos[0]!.texto).toBe('Temos manobrista.')
  })
  it('texto somado não passa de 1000 caracteres', () => {
    const r = juntarInformacoes({ fatos: [f({ texto: 'a'.repeat(900) })] }, { fatos: [f({ texto: 'b'.repeat(200) })] })
    expect(rascunhoInformacoesSchema.safeParse(r).success).toBe(true)
  })
  it('no máximo 100 fatos e idempotente', () => {
    const muitos = (p: string) => ({ fatos: Array.from({ length: 70 }, (_, k) => f({ tema: `${p} ${k}` })) })
    const r = juntarInformacoes(muitos('A'), muitos('B'))
    expect(r.fatos).toHaveLength(100)
    expect(juntarInformacoes(r, r)).toEqual(r)
  })
})

describe('juntarHorarios', () => {
  type U = RascunhoHorarios['unidades'][number]
  const u = (o: Partial<U> = {}): U => ({ unidade: 'Centro', semana: [], excecoes: [], incluir: true, ...o })
  const t = (abre: string, fecha: string) => ({ abre, fecha })
  const dia = (d: number, turnos: { abre: string; fecha: string }[], conflito = false) => ({ dia: d, turnos, conflito })

  it('por unidade (nome normalizado) e dia, com turnos ordenados e sem repetir', () => {
    const r = juntarHorarios(
      { unidades: [u({ semana: [dia(1, [t('18:00', '23:00')])] })] },
      { unidades: [u({ unidade: 'centro', semana: [dia(1, [t('11:00', '15:00'), t('18:00', '23:00')]), dia(0, [t('11:00', '16:00')])] })] },
    )
    expect(r.unidades).toHaveLength(1)
    expect(r.unidades[0]!.unidade).toBe('Centro')
    expect(r.unidades[0]!.semana).toEqual([dia(0, [t('11:00', '16:00')]), dia(1, [t('11:00', '15:00'), t('18:00', '23:00')])])
  })

  it('turnos sobrepostos marcam conflito (inclusive o que vira a madrugada)', () => {
    const r = juntarHorarios(
      { unidades: [u({ semana: [dia(5, [t('18:00', '02:00')])] })] },
      { unidades: [u({ semana: [dia(5, [t('22:00', '23:30')]), dia(6, [t('11:00', '15:00')])] })] },
    )
    expect(r.unidades[0]!.semana.find((d) => d.dia === 5)).toEqual(dia(5, [t('18:00', '02:00'), t('22:00', '23:30')], true))
    expect(r.unidades[0]!.semana.find((d) => d.dia === 6)!.conflito).toBe(false)
  })

  it('turnos encostados (fecha = abre) não são conflito', () => {
    const r = juntarHorarios(null, { unidades: [u({ semana: [dia(1, [t('15:00', '18:00'), t('11:00', '15:00')])] })] })
    expect(r.unidades[0]!.semana[0]).toEqual(dia(1, [t('11:00', '15:00'), t('15:00', '18:00')]))
  })

  it('mais de 6 turnos no dia: corta em 6 e marca conflito', () => {
    const turnos = (h0: number) => Array.from({ length: 4 }, (_, k) => t(`${String(h0 + k).padStart(2, '0')}:00`, `${String(h0 + k).padStart(2, '0')}:30`))
    const r = juntarHorarios({ unidades: [u({ semana: [dia(2, turnos(8))] })] }, { unidades: [u({ semana: [dia(2, turnos(14))] })] })
    expect(r.unidades[0]!.semana[0]!.turnos).toHaveLength(6)
    expect(r.unidades[0]!.semana[0]!.conflito).toBe(true)
    expect(rascunhoHorariosSchema.safeParse(r).success).toBe(true)
  })

  it('exceções por data: ordenadas; fechado × aberto na mesma data marca conflito e mantém a primeira', () => {
    const ex = (data: string, o: Partial<U['excecoes'][number]> = {}) => ({ data, fechado: true, turnos: [], motivo: null, conflito: false, ...o })
    const r = juntarHorarios(
      { unidades: [u({ excecoes: [ex('2026-12-31'), ex('2026-12-25', { motivo: 'Natal' })] })] },
      { unidades: [u({ excecoes: [ex('2026-12-25', { fechado: false, turnos: [t('11:00', '15:00')] }), ex('2026-12-24', { fechado: false, turnos: [t('11:00', '15:00')] })] })] },
    )
    expect(r.unidades[0]!.excecoes.map((e) => e.data)).toEqual(['2026-12-24', '2026-12-25', '2026-12-31'])
    expect(r.unidades[0]!.excecoes[1]).toEqual(ex('2026-12-25', { motivo: 'Natal', conflito: true }))
  })

  it('unidade não reconhecida (null) junta com outra null e fica separada das nomeadas', () => {
    const r = juntarHorarios({ unidades: [u({ unidade: null })] }, { unidades: [u({ unidade: null }), u()] })
    expect(r.unidades.map((x) => x.unidade)).toEqual([null, 'Centro'])
  })

  it('I3: dia fechado num lote e aberto noutro marca conflito e mantém o acumulado', () => {
    const fechadoPrimeiro = juntarHorarios({ unidades: [u({ semana: [dia(1, [])] })] }, { unidades: [u({ semana: [dia(1, [t('11:00', '15:00')])] })] })
    expect(fechadoPrimeiro.unidades[0]!.semana).toEqual([dia(1, [], true)])
    const abertoPrimeiro = juntarHorarios({ unidades: [u({ semana: [dia(1, [t('11:00', '15:00')])] })] }, { unidades: [u({ semana: [dia(1, [])] })] })
    expect(abertoPrimeiro.unidades[0]!.semana).toEqual([dia(1, [t('11:00', '15:00')], true)])
    expect(rascunhoHorariosSchema.safeParse(fechadoPrimeiro).success).toBe(true)
    expect(juntarHorarios(fechadoPrimeiro, fechadoPrimeiro)).toEqual(fechadoPrimeiro)
  })

  it('dia fechado nos dois lotes continua fechado e sem conflito', () => {
    const r = juntarHorarios({ unidades: [u({ semana: [dia(0, [])] })] }, { unidades: [u({ semana: [dia(0, [])] })] })
    expect(r.unidades[0]!.semana).toEqual([dia(0, [])])
  })

  it('é idempotente, inclusive com conflito', () => {
    const a = juntarHorarios(
      { unidades: [u({ semana: [dia(5, [t('18:00', '02:00')])] })] },
      { unidades: [u({ semana: [dia(5, [t('22:00', '23:30')])], excecoes: [{ data: '2026-12-25', fechado: true, turnos: [], motivo: null, conflito: false }] })] },
    )
    expect(juntarHorarios(a, a)).toEqual(a)
  })
})

describe('juntarEspacos', () => {
  type E = RascunhoEspacos['espacos'][number]
  const e = (o: Partial<E> = {}): E => ({
    nome: 'Salão VIP', unidade: 'Centro', capacidadeMin: 10, capacidadeMax: 40, descricao: null, condicoes: null, incluir: true, ...o,
  })
  it('dedupe por nome e unidade; campos vazios completados pela outra leitura', () => {
    const r = juntarEspacos({ espacos: [e()] }, { espacos: [e({ nome: 'salao vip', descricao: 'Com ar', capacidadeMax: 50 }), e({ unidade: 'Praia' })] })
    expect(r.espacos).toEqual([e({ descricao: 'Com ar' }), e({ unidade: 'Praia' })])
  })
  it('I2: capacidade incompleta é aceita no schema e uma leitura completa posterior a substitui', () => {
    const incompleto = e({ capacidadeMin: 1, capacidadeMax: 40, capacidadeIncompleta: true })
    expect(rascunhoEspacosSchema.parse({ espacos: [incompleto] }).espacos[0]!.capacidadeIncompleta).toBe(true)
    const r = juntarEspacos({ espacos: [incompleto] }, { espacos: [e({ capacidadeMin: 20, capacidadeMax: 40 })] })
    expect(r.espacos).toEqual([e({ capacidadeMin: 20, capacidadeMax: 40 })])
    // completo primeiro: a incompleta não o rebaixa
    expect(juntarEspacos({ espacos: [e()] }, { espacos: [incompleto] }).espacos).toEqual([e()])
    // duas incompletas: fica a primeira, ainda marcada
    expect(juntarEspacos({ espacos: [incompleto] }, { espacos: [e({ capacidadeMin: 12, capacidadeMax: 12, capacidadeIncompleta: true })] }).espacos).toEqual([incompleto])
  })
  it('é idempotente', () => {
    const a = juntarEspacos({ espacos: [e()] }, { espacos: [e({ nome: 'Varanda', condicoes: 'Sinal de 30%' })] })
    expect(juntarEspacos(a, a)).toEqual(a)
  })
})
