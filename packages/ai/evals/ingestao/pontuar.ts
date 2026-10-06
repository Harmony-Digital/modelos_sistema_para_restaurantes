import { normalizeText, type RascunhoCardapio } from '@atd/core'
import type { Exemplo } from './gabarito.ts'

const nome = (s: string) => normalizeText(s).replace(/[^a-z0-9]+/g, ' ').trim()
/** Mesmo item: nomes normalizados iguais, ou um contido no outro ("Picanha" ≈ "Picanha na brasa"). */
const mesmoNome = (a: string, b: string) => {
  const x = nome(a)
  const y = nome(b)
  return x.length > 0 && y.length > 0 && (x === y || x.includes(y) || y.includes(x))
}

export type Pontuacao = { total: number; acertos: number; faltando: string[]; precoErrado: string[]; inventados: string[] }

/** Acerto = item do gabarito presente no rascunho com o MESMO preço (null = sob consulta). Itens a mais são "inventados". */
export function pontuarIngestao(exemplo: Exemplo, rascunho: RascunhoCardapio): Pontuacao {
  const lidos = rascunho.categorias.flatMap((c) => c.itens)
  const esperados = exemplo.categorias.flatMap((c) => c.itens)
  const p: Pontuacao = { total: esperados.length, acertos: 0, faltando: [], precoErrado: [], inventados: [] }
  const usados = new Set<number>()
  for (const e of esperados) {
    const i = lidos.findIndex((l, idx) => !usados.has(idx) && mesmoNome(l.nome, e.nome))
    if (i < 0) {
      p.faltando.push(e.nome)
      continue
    }
    usados.add(i)
    if (lidos[i]!.precoCentavos === e.precoCentavos) p.acertos++
    else p.precoErrado.push(`${e.nome}: esperado ${e.precoCentavos}, lido ${lidos[i]!.precoCentavos}`)
  }
  p.inventados = lidos.filter((_, idx) => !usados.has(idx)).map((l) => l.nome)
  return p
}
