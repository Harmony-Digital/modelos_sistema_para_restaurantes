import { describe, expect, it } from 'vitest'
import { chaveLacuna, encontrarFato, encontrarUnidade, escolhaDeUnidade, similaridade } from './busca.ts'

const unidades = [
  { id: 'as', nome: 'Asa Sul', apelidos: ['204 sul'] },
  { id: 'an', nome: 'Asa Norte', apelidos: [] },
  { id: 'ls', nome: 'Lago Sul', apelidos: [] },
  { id: 'ac', nome: 'Águas Claras', apelidos: ['AC'] },
]
const fatos = [
  { id: 'est', tema: 'Estacionamento', exemplos: ['tem vaga', 'onde estacionar'], unitId: null },
  { id: 'wifi', tema: 'Wi-Fi', exemplos: ['internet', 'senha do wifi'], unitId: 'as' },
  { id: 'pet', tema: 'Pet friendly', exemplos: ['aceita cachorro', 'pode levar animal'], unitId: null },
  { id: 'musica', tema: 'Música ao vivo', exemplos: ['tem show'], unitId: 'an' },
]
const id = (u: { id: string } | null) => u?.id ?? null

describe('similaridade', () => {
  it('igual = 1, sem nada em comum = 0, tolera erro de digitação', () => {
    expect(similaridade('Asa Sul', 'asa sul')).toBe(1)
    expect(similaridade('asa sul', 'xyz')).toBe(0)
    expect(similaridade('aza sul', 'asa sul')).toBeGreaterThan(0.4)
  })
})

describe('encontrarUnidade', () => {
  it('nome, apelido, acento e prefixos ("unidade da")', () => {
    expect(id(encontrarUnidade('asa sul', unidades))).toBe('as')
    expect(id(encontrarUnidade('unidade da Asa Sul', unidades))).toBe('as')
    expect(id(encontrarUnidade('aguas claras', unidades))).toBe('ac')
    expect(id(encontrarUnidade('AC', unidades))).toBe('ac')
    expect(id(encontrarUnidade('204 sul', unidades))).toBe('as')
    expect(id(encontrarUnidade('asa sul de brasília', unidades))).toBe('as')
  })
  it('erros de digitação', () => {
    expect(id(encontrarUnidade('aza sul', unidades))).toBe('as')
    expect(id(encontrarUnidade('asa sull', unidades))).toBe('as')
    expect(id(encontrarUnidade('lagosul', unidades))).toBe('ls')
    expect(id(encontrarUnidade('agua claras', unidades))).toBe('ac')
  })
  it('ambíguo, desconhecido ou vazio ⇒ null', () => {
    expect(encontrarUnidade('asa', unidades)).toBeNull()
    expect(encontrarUnidade('sul', unidades)).toBeNull()
    expect(encontrarUnidade('centro', unidades)).toBeNull()
    expect(encontrarUnidade('lago norte', unidades)).toBeNull()
    expect(encontrarUnidade(null, unidades)).toBeNull()
    expect(encontrarUnidade('   ', unidades)).toBeNull()
  })
})

describe('escolhaDeUnidade', () => {
  it('só aceita o nome (ou apelido) quase exato, nunca uma pergunta', () => {
    expect(id(escolhaDeUnidade('Lago Sul', unidades))).toBe('ls')
    expect(id(escolhaDeUnidade('lago sull', unidades))).toBe('ls')
    expect(id(escolhaDeUnidade('AC', unidades))).toBe('ac')
    expect(escolhaDeUnidade('asa', unidades)).toBeNull()
    expect(escolhaDeUnidade('Asa Sul fecha quando?', unidades)).toBeNull()
    expect(escolhaDeUnidade('lago sul tem estacionamento', unidades)).toBeNull()
    expect(escolhaDeUnidade('', unidades)).toBeNull()
  })
})

describe('encontrarFato', () => {
  it('por tema e por exemplos', () => {
    expect(id(encontrarFato('estacionamento', fatos, null))).toBe('est')
    expect(id(encontrarFato('cachorro', fatos, null))).toBe('pet')
    expect(id(encontrarFato('musica ao vivo', fatos, 'an'))).toBe('musica')
  })
  it('fato de unidade: vale sem unidade informada, não vale para outra unidade', () => {
    expect(id(encontrarFato('wifi', fatos, null))).toBe('wifi')
    expect(id(encontrarFato('wifi', fatos, 'as'))).toBe('wifi')
    expect(encontrarFato('wifi', fatos, 'an')).toBeNull()
  })
  it('desempate: unidade informada prefere o fato dela; sem unidade prefere o geral', () => {
    const dois = [
      { id: 'geral', tema: 'Estacionamento', exemplos: [], unitId: null },
      { id: 'da-as', tema: 'Estacionamento', exemplos: [], unitId: 'as' },
    ]
    expect(id(encontrarFato('estacionamento', dois, 'as'))).toBe('da-as')
    expect(id(encontrarFato('estacionamento', dois, null))).toBe('geral')
  })
  it('palavras genéricas não casam por contenção', () => {
    expect(encontrarFato('tem', fatos, null)).toBeNull()
    expect(encontrarFato('pode', fatos, null)).toBeNull()
    expect(id(encontrarFato('cachorro', fatos, null))).toBe('pet')
  })
  it('sem correspondência ⇒ null', () => {
    expect(encontrarFato('area kids', fatos, null)).toBeNull()
    expect(encontrarFato(null, fatos, null)).toBeNull()
  })
})

describe('chaveLacuna', () => {
  it('normaliza o tema', () => {
    expect(chaveLacuna('info', 'Área Kids!')).toBe('info:area kids')
    expect(chaveLacuna('info', null)).toBe('info:geral')
    expect(chaveLacuna('horario')).toBe('horario')
    expect(chaveLacuna('endereco')).toBe('endereco')
  })
})
