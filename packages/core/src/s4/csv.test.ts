import { describe, expect, it } from 'vitest'
import { lerCsvCardapio, lerPrecoCsv } from './csv.ts'
import { rascunhoSchema } from './rascunho.ts'

const CAB = 'categoria,nome,descricao,preco,tags,outros_nomes,unidade'

describe('lerPrecoCsv', () => {
  it('aceita vírgula ou ponto decimal, milhar e R$', () => {
    expect(lerPrecoCsv('59,90')).toEqual({ ok: true, centavos: 5990 })
    expect(lerPrecoCsv('59.90')).toEqual({ ok: true, centavos: 5990 })
    expect(lerPrecoCsv('59')).toEqual({ ok: true, centavos: 5900 })
    expect(lerPrecoCsv('59,9')).toEqual({ ok: true, centavos: 5990 })
    expect(lerPrecoCsv('R$ 1.234,56')).toEqual({ ok: true, centavos: 123456 })
    expect(lerPrecoCsv('1,234.56')).toEqual({ ok: true, centavos: 123456 })
    expect(lerPrecoCsv('1.234')).toEqual({ ok: true, centavos: 123400 })
    expect(lerPrecoCsv(' ')).toEqual({ ok: true, centavos: null })
  })

  it('recusa texto, negativo, três casas decimais e acima do limite', () => {
    for (const v of ['abc', '-5', '5,999', '1.2.3', '100000,01', '5,', ',5']) expect(lerPrecoCsv(v).ok, v).toBe(false)
    expect(lerPrecoCsv('100000,00')).toEqual({ ok: true, centavos: 10_000_000 })
  })
})

describe('lerCsvCardapio', () => {
  it('lê com vírgula, agrupa por categoria na ordem e separa tags/outros nomes por |', () => {
    const csv = [
      CAB,
      'Carnes,Picanha,Corte grelhado,"59,90",Sem Glúten|  |bebida,pica|picanha na brasa,',
      'Sobremesas,Pudim,,14.00,,,',
      'carnes,Fraldinha,,,,,Asa Sul',
    ].join('\n')
    const { rascunho, erros } = lerCsvCardapio(csv)
    expect(erros).toEqual([])
    expect(rascunho).toEqual({
      categorias: [
        {
          nome: 'Carnes',
          itens: [
            { nome: 'Picanha', descricao: 'Corte grelhado', precoCentavos: 5990, tags: ['sem_gluten', 'bebida'], outrosNomes: ['pica', 'picanha na brasa'], unidade: null, incluir: true },
            { nome: 'Fraldinha', descricao: null, precoCentavos: null, tags: [], outrosNomes: [], unidade: 'Asa Sul', incluir: true },
          ],
        },
        { nome: 'Sobremesas', itens: [{ nome: 'Pudim', descricao: null, precoCentavos: 1400, tags: [], outrosNomes: [], unidade: null, incluir: true }] },
      ],
    })
    expect(rascunhoSchema.safeParse(rascunho).success).toBe(true)
  })

  it('separador ; , BOM UTF-8, CRLF, cabeçalho em outra ordem/com acento e linhas vazias', () => {
    const csv = '﻿Nome;Categoria;Preço;Descrição\r\n\r\nPicanha;Carnes;59,90;"Com ""farofa""; e vinagrete"\r\n;;;\r\n'
    const { rascunho, erros } = lerCsvCardapio(csv)
    expect(erros).toEqual([])
    expect(rascunho.categorias).toEqual([
      { nome: 'Carnes', itens: [{ nome: 'Picanha', descricao: 'Com "farofa"; e vinagrete', precoCentavos: 5990, tags: [], outrosNomes: [], unidade: null, incluir: true }] },
    ])
  })

  it('campo entre aspas com quebra de linha conta as linhas certas', () => {
    const csv = `${CAB}\nCarnes,Picanha,"linha 1\nlinha 2",10,,,\nCarnes,,x,10,,,`
    const { rascunho, erros } = lerCsvCardapio(csv)
    expect(rascunho.categorias[0]!.itens[0]!.descricao).toBe('linha 1\nlinha 2')
    expect(erros).toEqual([{ linha: 4, mensagem: 'Linha 4: nome vazio.' }])
  })

  it('erros por linha, sem derrubar as linhas boas', () => {
    const csv = [
      CAB,
      'Carnes,Picanha,,abc,,,',
      ',Sem categoria,,10,,,',
      `Carnes,${'x'.repeat(81)},,10,,,`,
      `Carnes,Longa,${'d'.repeat(301)},10,,,`,
      'Carnes,Cara,,"200000,00",,,',
      'Carnes,Ok,,10,,,',
      'Carnes,Demais,,10,,,,extra',
      'Carnes,ok,,12,,,',
    ].join('\n')
    const { rascunho, erros } = lerCsvCardapio(csv)
    expect(erros).toEqual([
      { linha: 2, mensagem: 'Linha 2: preço inválido.' },
      { linha: 3, mensagem: 'Linha 3: categoria vazia.' },
      { linha: 4, mensagem: 'Linha 4: nome com mais de 80 caracteres.' },
      { linha: 5, mensagem: 'Linha 5: descrição com mais de 300 caracteres.' },
      { linha: 6, mensagem: 'Linha 6: preço inválido.' },
      { linha: 8, mensagem: 'Linha 8: colunas a mais que o cabeçalho.' },
      { linha: 9, mensagem: 'Linha 9: item repetido (linha 7).' },
    ])
    expect(rascunho.categorias).toEqual([
      { nome: 'Carnes', itens: [{ nome: 'Ok', descricao: null, precoCentavos: 1000, tags: [], outrosNomes: [], unidade: null, incluir: true }] },
    ])
  })

  it('mesmo item em unidades diferentes não é repetido', () => {
    const csv = `${CAB}\nCarnes,Picanha,,10,,,Asa Sul\nCarnes,Picanha,,12,,,Asa Norte\nCarnes,Picanha,,9,,,`
    const { rascunho, erros } = lerCsvCardapio(csv)
    expect(erros).toEqual([])
    expect(rascunho.categorias[0]!.itens.map((i) => i.unidade)).toEqual(['Asa Sul', 'Asa Norte', null])
  })

  it('sem cabeçalho (ou sem categoria/nome): erro na linha 1 e rascunho vazio', () => {
    expect(lerCsvCardapio('Carnes,Picanha,,10')).toEqual({
      rascunho: { categorias: [] },
      erros: [{ linha: 1, mensagem: 'Linha 1: cabeçalho deve ter as colunas categoria e nome.' }],
    })
    expect(lerCsvCardapio('categoria,preco\nCarnes,10').erros).toEqual([{ linha: 1, mensagem: 'Linha 1: cabeçalho deve ter as colunas categoria e nome.' }])
    expect(lerCsvCardapio('categoria,nome,categoria\nA,B,C').erros).toEqual([{ linha: 1, mensagem: 'Linha 1: coluna "categoria" repetida.' }])
  })

  it('arquivo vazio ou só cabeçalho', () => {
    expect(lerCsvCardapio('').erros).toEqual([{ linha: 1, mensagem: 'Linha 1: arquivo vazio.' }])
    expect(lerCsvCardapio('﻿\n\n').erros).toEqual([{ linha: 1, mensagem: 'Linha 1: arquivo vazio.' }])
    expect(lerCsvCardapio(CAB)).toEqual({ rascunho: { categorias: [] }, erros: [{ linha: 1, mensagem: 'Linha 1: nenhum item na planilha.' }] })
  })

  it('aspas sem fechar: erro na linha onde começou', () => {
    const { erros } = lerCsvCardapio(`${CAB}\nCarnes,Picanha,"sem fim,10,,,`)
    expect(erros).toEqual([{ linha: 2, mensagem: 'Linha 2: aspas sem fechar.' }])
  })

  it('limites do rascunho: 50 categorias e 500 itens', () => {
    const cats = Array.from({ length: 51 }, (_, i) => `C${i},Item ${i},,1,,,`)
    const r1 = lerCsvCardapio([CAB, ...cats].join('\n'))
    expect(r1.rascunho.categorias).toHaveLength(50)
    expect(r1.erros).toEqual([{ linha: 52, mensagem: 'Linha 52: limite de 50 categorias.' }])
    const itens = Array.from({ length: 501 }, (_, i) => `C,Item ${i},,1,,,`)
    const r2 = lerCsvCardapio([CAB, ...itens].join('\n'))
    expect(r2.rascunho.categorias[0]!.itens).toHaveLength(500)
    expect(r2.erros).toEqual([{ linha: 502, mensagem: 'Linha 502: limite de 500 itens.' }])
    expect(rascunhoSchema.safeParse(r2.rascunho).success).toBe(true)
  })

  it('tags e outros nomes: limites e tamanho por linha', () => {
    const muitas = Array.from({ length: 11 }, (_, i) => `t${i}`).join('|')
    const { erros } = lerCsvCardapio(`${CAB}\nC,A,,1,${muitas},,\nC,B,,1,,${'n'.repeat(81)},`)
    expect(erros).toEqual([
      { linha: 2, mensagem: 'Linha 2: no máximo 10 tags.' },
      { linha: 3, mensagem: 'Linha 3: outro nome com mais de 80 caracteres.' },
    ])
  })
})
