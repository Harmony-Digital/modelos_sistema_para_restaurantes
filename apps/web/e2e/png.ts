import { crc32, deflateSync } from 'node:zlib'

function bloco(tipo: string, dados: Buffer): Buffer {
  const tamanho = Buffer.alloc(4)
  tamanho.writeUInt32BE(dados.length)
  const corpo = Buffer.concat([Buffer.from(tipo, 'latin1'), dados])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(corpo))
  return Buffer.concat([tamanho, corpo, crc])
}

/**
 * PNG de verdade (RGB, 8 bits) com largura × altura em duas cores (metade esquerda e direita), para o e2e da logo:
 * proporções extremas (4000×200) e pequenas (50×50) sem arquivo binário no repositório. Comprimido, fica com poucos KB.
 */
export function pngDeTeste(largura: number, altura: number, cor: [number, number, number] = [200, 60, 20]): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(largura, 0)
  ihdr.writeUInt32BE(altura, 4)
  ihdr.set([8, 2, 0, 0, 0], 8) // 8 bits, RGB, deflate, filtro padrão, sem entrelaçamento
  const linha = Buffer.alloc(1 + largura * 3) // byte 0 = filtro "nenhum"
  for (let x = 0; x < largura; x++) linha.set(x < largura / 2 ? cor : [20, 60, 200], 1 + x * 3)
  const bruto = Buffer.concat(Array.from({ length: altura }, () => linha))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco('IHDR', ihdr),
    bloco('IDAT', deflateSync(bruto)),
    bloco('IEND', Buffer.alloc(0)),
  ])
}
