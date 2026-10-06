/**
 * Gera os arquivos de exemplo (INVENTADOS) do eval de leitura de cardápio, a partir do gabarito, sem dependências:
 * um PDF de texto simples (Helvetica) e um PNG pequeno (fonte bitmap 5x7, tons de cinza).
 * Uso: node evals/ingestao/gerar-exemplos.ts   (grava em evals/ingestao/exemplos/)
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { crc32, deflateSync } from 'node:zlib'
import { EXEMPLO_PDF, EXEMPLO_PNG, INSTRUCAO_MALICIOSA, precoNoDocumento, type Exemplo } from './gabarito.ts'

// ------------------------------------------------------------- PDF

const escaparPdf = (s: string) => s.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')

/** Linhas do PDF: [fonte, tamanho, texto]. */
function linhasPdf(ex: Exemplo): [string, number, string][] {
  const linhas: [string, number, string][] = [['F1', 18, ex.titulo], ['F2', 10, ' ']]
  for (const c of ex.categorias) {
    linhas.push(['F1', 13, c.nome])
    for (const i of c.itens) {
      linhas.push(['F2', 11, `${i.nome}  ....  ${precoNoDocumento(i.precoCentavos)}`])
      if (i.descricao) linhas.push(['F2', 9, `   ${i.descricao}`])
    }
    linhas.push(['F2', 10, ' '])
  }
  linhas.push(['F2', 8, INSTRUCAO_MALICIOSA])
  return linhas
}

export function gerarPdf(ex: Exemplo = EXEMPLO_PDF): Buffer {
  let y = 790
  const ops = ['BT']
  for (const [fonte, tamanho, texto] of linhasPdf(ex)) {
    ops.push(`/${fonte} ${tamanho} Tf 1 0 0 1 56 ${y} Tm (${escaparPdf(texto)}) Tj`)
    y -= Math.round(tamanho * 1.6)
  }
  ops.push('ET')
  const conteudo = ops.join('\n')
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(conteudo, 'latin1')} >>\nstream\n${conteudo}\nendstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objetos.forEach((o, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'))
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

// ------------------------------------------------------------- PNG (fonte bitmap 5x7)

export const FONTE: Record<string, string> = {
  A: '.###.#...##...#######...##...##...#', B: '####.#...##...#####.#...##...#####.', C: '.###.#...##....#....#....#...#.###.',
  D: '####.#...##...##...##...##...#####.', E: '######....#....####.#....#....#####', F: '######....#....####.#....#....#....',
  G: '.###.#...##....#.####...##...#.####', H: '#...##...##...#######...##...##...#', I: '.###...#....#....#....#....#...###.',
  J: '..###...#....#....#....#.#..#..##..', K: '#...##..#.#.#..##...#.#..#..#.#...#', L: '#....#....#....#....#....#....#####',
  M: '#...###.###.#.##.#.##...##...##...#', N: '#...##...###..##.#.##..###...##...#', O: '.###.#...##...##...##...##...#.###.',
  P: '####.#...##...#####.#....#....#....', Q: '.###.#...##...##...##.#.##..#..##.#', R: '####.#...##...#####.#.#..#..#.#...#',
  S: '.#####....#.....###.....#....#####.', T: '#####..#....#....#....#....#....#..', U: '#...##...##...##...##...##...#.###.',
  V: '#...##...##...##...##...#.#.#...#..', W: '#...##...##...##.#.##.#.##.#.#.#.#.', X: '#...##...#.#.#...#...#.#.#...##...#',
  Y: '#...##...#.#.#...#....#....#....#..', Z: '#####....#...#...#...#...#....#####', 0: '.###.#...##..###.#.###..##...#.###.',
  1: '..#...##....#....#....#....#...###.', 2: '.###.#...#....#...#...#...#...#####', 3: '#####...#...#.....#.....##...#.###.',
  4: '...#...##..#.#.#..#.#####...#....#.', 5: '######....####.....#....##...#.###.', 6: '..##..#...#....####.#...##...#.###.',
  7: '#####....#...#...#...#....#....#...', 8: '.###.#...##...#.###.#...##...#.###.', 9: '.###.#...##...#.####....#...#..##..',
  $: '..#...#####.#...###...#.#####...#..', ',': '.....................##....#...#...', '.': '..........................##...##..',
  ':': '......##...##........##...##.......', '-': '...............#####...............', ' ': '...................................',
}
const ESCALA = 3
const MARGEM = 24

function linhasPng(ex: Exemplo): string[] {
  return [ex.titulo, '', ...ex.categorias.flatMap((c) => c.itens.map((i) => `${i.nome}  ${precoNoDocumento(i.precoCentavos)}`))]
}

/** Pixels (1 byte por pixel, 0 = preto, 255 = branco), linha a linha, sem o byte de filtro. */
export function pixelsPng(ex: Exemplo = EXEMPLO_PNG): { largura: number; altura: number; pixels: Buffer } {
  const linhas = linhasPng(ex).map((l) => l.toUpperCase())
  const colunas = Math.max(...linhas.map((l) => l.length))
  const largura = MARGEM * 2 + colunas * 6 * ESCALA
  const altura = MARGEM * 2 + linhas.length * 10 * ESCALA
  const pixels = Buffer.alloc(largura * altura, 255)
  linhas.forEach((linha, li) => {
    ;[...linha].forEach((ch, ci) => {
      const glifo = FONTE[ch]
      if (!glifo) throw new Error(`caractere sem glifo: ${ch}`)
      for (let gy = 0; gy < 7; gy++) {
        for (let gx = 0; gx < 5; gx++) {
          if (glifo[gy * 5 + gx] !== '#') continue
          for (let dy = 0; dy < ESCALA; dy++) {
            for (let dx = 0; dx < ESCALA; dx++) {
              const x = MARGEM + (ci * 6 + gx) * ESCALA + dx
              const y = MARGEM + (li * 10 + gy) * ESCALA + dy
              pixels[y * largura + x] = 0
            }
          }
        }
      }
    })
  })
  return { largura, altura, pixels }
}

function bloco(tipo: string, dados: Buffer): Buffer {
  const t = Buffer.from(tipo, 'latin1')
  const tamanho = Buffer.alloc(4)
  tamanho.writeUInt32BE(dados.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, dados])) >>> 0)
  return Buffer.concat([tamanho, t, dados, crc])
}

export function gerarPng(ex: Exemplo = EXEMPLO_PNG): Buffer {
  const { largura, altura, pixels } = pixelsPng(ex)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(largura, 0)
  ihdr.writeUInt32BE(altura, 4)
  ihdr.writeUInt8(8, 8) // 8 bits
  ihdr.writeUInt8(0, 9) // tons de cinza
  const cru = Buffer.alloc((largura + 1) * altura)
  for (let y = 0; y < altura; y++) pixels.copy(cru, y * (largura + 1) + 1, y * largura, (y + 1) * largura) // filtro 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco('IHDR', ihdr),
    bloco('IDAT', deflateSync(cru, { level: 9 })),
    bloco('IEND', Buffer.alloc(0)),
  ])
}

export const PASTA_EXEMPLOS = new URL('./exemplos/', import.meta.url)

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  mkdirSync(PASTA_EXEMPLOS, { recursive: true })
  writeFileSync(new URL(EXEMPLO_PDF.arquivo, PASTA_EXEMPLOS), gerarPdf())
  writeFileSync(new URL(EXEMPLO_PNG.arquivo, PASTA_EXEMPLOS), gerarPng())
  process.stdout.write(`Exemplos gravados em ${PASTA_EXEMPLOS.pathname}\n`)
}
