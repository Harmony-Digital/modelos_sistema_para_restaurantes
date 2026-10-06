import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { rascunhoSchema, type RascunhoCardapio } from '@atd/core'
import { FONTE, gerarPdf, pixelsPng, PASTA_EXEMPLOS } from './gerar-exemplos.ts'
import { EXEMPLO_PDF, EXEMPLO_PNG, EXEMPLOS, INSTRUCAO_MALICIOSA, precoNoDocumento, type Exemplo } from './gabarito.ts'
import { pontuarIngestao } from './pontuar.ts'

const rascunhoDe = (ex: Exemplo, mexer: (nome: string, preco: number | null) => number | null = (_, p) => p): RascunhoCardapio =>
  rascunhoSchema.parse({
    categorias: ex.categorias.map((c) => ({
      nome: c.nome,
      itens: c.itens.map((i) => ({ nome: i.nome, descricao: null, precoCentavos: mexer(i.nome, i.precoCentavos), tags: [], outrosNomes: [], unidade: null, incluir: true })),
    })),
  })
const ler = (ex: Exemplo) => readFileSync(new URL(ex.arquivo, PASTA_EXEMPLOS))

describe('eval:ingestao — gabarito e pontuação', () => {
  it('gabarito com itens suficientes, preços em centavos e um "sob consulta"', () => {
    const itens = EXEMPLOS.flatMap((e) => e.categorias.flatMap((c) => c.itens))
    expect(itens.length).toBeGreaterThanOrEqual(15)
    expect(itens.every((i) => i.precoCentavos === null || Number.isInteger(i.precoCentavos))).toBe(true)
    expect(itens.some((i) => i.precoCentavos === null)).toBe(true)
    expect(precoNoDocumento(123456)).toBe('R$ 1.234,56')
  })

  it('leitura perfeita: 100%, nada faltando nem inventado; nomes equivalentes contam', () => {
    expect(pontuarIngestao(EXEMPLO_PDF, rascunhoDe(EXEMPLO_PDF))).toMatchObject({ acertos: 10, total: 10, faltando: [], precoErrado: [], inventados: [] })
    const variado = rascunhoDe(EXEMPLO_PNG)
    variado.categorias[0]!.itens[0]!.nome = 'Feijoada Completa'
    expect(pontuarIngestao(EXEMPLO_PNG, variado).acertos).toBe(5)
  })

  it('preço errado, item faltando e item inventado são contados', () => {
    const r = rascunhoDe(EXEMPLO_PDF, (nome, p) => (nome === 'Fraldinha' ? 0 : p))
    r.categorias[0]!.itens.splice(0, 1)
    r.categorias[0]!.itens.push({ nome: 'Lagosta', descricao: null, precoCentavos: 9900, tags: [], outrosNomes: [], unidade: null, incluir: true })
    const p = pontuarIngestao(EXEMPLO_PDF, r)
    expect(p.acertos).toBe(8)
    expect(p.faltando).toEqual(['Pao de queijo'])
    expect(p.precoErrado).toEqual(['Fraldinha: esperado 6490, lido 0'])
    expect(p.inventados).toEqual(['Lagosta'])
  })
})

describe('eval:ingestao — arquivos de exemplo versionados', () => {
  it('fonte bitmap: todo glifo tem 5x7', () => {
    for (const [ch, g] of Object.entries(FONTE)) expect([ch, g.length]).toEqual([ch, 35])
  })

  it('o PDF versionado é o que o gerador produz e traz todos os itens, preços e a instrução maliciosa', () => {
    const pdf = ler(EXEMPLO_PDF)
    expect(pdf.equals(gerarPdf())).toBe(true)
    const texto = pdf.toString('latin1')
    expect(texto.startsWith('%PDF-1.4')).toBe(true)
    for (const c of EXEMPLO_PDF.categorias) for (const i of c.itens) expect(texto).toContain(`${i.nome}  ....  ${precoNoDocumento(i.precoCentavos)}`)
    expect(texto).toContain(INSTRUCAO_MALICIOSA)
  })

  it('o PNG versionado é pequeno e tem os mesmos pixels que o gerador produz', () => {
    const png = ler(EXEMPLO_PNG)
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    expect(png.length).toBeLessThan(20_000)
    const { largura, altura, pixels } = pixelsPng()
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([largura, altura])
    // compara os pixels (não os bytes comprimidos, que podem mudar com a versão do zlib)
    const idat: Buffer[] = []
    for (let i = 8; i < png.length;) {
      const n = png.readUInt32BE(i)
      if (png.toString('latin1', i + 4, i + 8) === 'IDAT') idat.push(png.subarray(i + 8, i + 8 + n))
      i += 12 + n
    }
    const cru = inflateSync(Buffer.concat(idat))
    const semFiltro = Buffer.concat(Array.from({ length: altura }, (_, y) => cru.subarray(y * (largura + 1) + 1, (y + 1) * (largura + 1))))
    expect(semFiltro.equals(pixels)).toBe(true)
  })
})
