import { normalizeText } from '@atd/core'
import type { RascunhoEspacos, RascunhoHorarios, RascunhoInformacoes } from '@atd/core/importacao'
import type { Exemplo, ExemploEspacos, ExemploHorarios, ExemploInformacoes, TurnoGabarito } from './gabarito.ts'

const nome = (s: string) => normalizeText(s).replace(/[^a-z0-9]+/g, ' ').trim()
/** Mesmo item: nomes normalizados iguais, ou um contido no outro ("Picanha" ≈ "Picanha na brasa"). */
const mesmoNome = (a: string, b: string) => {
  const x = nome(a)
  const y = nome(b)
  return x.length > 0 && y.length > 0 && (x === y || x.includes(y) || y.includes(x))
}

export type Pontuacao = { total: number; acertos: number; faltando: string[]; precoErrado: string[]; inventados: string[] }

/** Acerto = item do gabarito presente no rascunho com o MESMO preço (null = sob consulta). Itens a mais são "inventados". */
export function pontuarIngestao(
  exemplo: Exemplo,
  rascunho: { categorias: { itens: { nome: string; precoCentavos: number | null }[] }[] },
): Pontuacao {
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

// ------------------------------------------------------------- Etapa 07: pontuação por alvo

/** Pontuação comum dos alvos: `erros` explica cada ponto perdido; `aMais` lista o que foi lido e não está no gabarito. */
export type PontuacaoAlvo = { total: number; acertos: number; erros: string[]; aMais: string[] }

/** Cardápio (completo ou só preços): nome + preço, como no eval da Etapa 05. */
export function pontuarCardapio(exemplo: Exemplo, rascunho: Parameters<typeof pontuarIngestao>[1]): PontuacaoAlvo {
  const p = pontuarIngestao(exemplo, rascunho)
  return { total: p.total, acertos: p.acertos, erros: [...p.faltando.map((n) => `${n}: faltando`), ...p.precoErrado], aMais: p.inventados }
}

const sem = (s: string) => normalizeText(s).replace(/[^a-z0-9]+/g, ' ').trim()
const mesmaUnidade = (a: string | null, b: string | null) => (a === null || b === null ? a === b : mesmoNome(a, b))

/** Informações: fato com o tema (ou um sinônimo aceito), o texto com todos os trechos-chave e a unidade certa. */
export function pontuarInformacoes(exemplo: ExemploInformacoes, rascunho: RascunhoInformacoes): PontuacaoAlvo {
  const p: PontuacaoAlvo = { total: exemplo.fatos.length, acertos: 0, erros: [], aMais: [] }
  const usados = new Set<number>()
  for (const e of exemplo.fatos) {
    const nome = e.temas[0]!
    const i = rascunho.fatos.findIndex((f, idx) => !usados.has(idx) && e.temas.some((t) => mesmoNome(f.tema, t)))
    if (i < 0) {
      p.erros.push(`${nome}: faltando`)
      continue
    }
    usados.add(i)
    const f = rascunho.fatos[i]!
    const faltam = e.chaves.filter((c) => !sem(f.texto).includes(sem(c)))
    if (faltam.length) p.erros.push(`${nome}: texto sem ${faltam.map((c) => `"${c}"`).join(', ')}`)
    else if (!mesmaUnidade(f.unidade, e.unidade)) p.erros.push(`${nome}: unidade esperada ${e.unidade}, lida ${f.unidade}`)
    else p.acertos++
  }
  p.aMais = rascunho.fatos.filter((_, idx) => !usados.has(idx)).map((f) => f.tema)
  return p
}

const turnosTexto = (ts: readonly TurnoGabarito[]) =>
  [...ts].sort((a, b) => a.abre.localeCompare(b.abre)).map((t) => `${t.abre}-${t.fecha}`).join(' ') || 'fechado'

/** Horários: um ponto por dia da semana do gabarito e por exceção (data, fechado e turnos exatos). */
export function pontuarHorarios(exemplo: ExemploHorarios, rascunho: RascunhoHorarios): PontuacaoAlvo {
  const total = exemplo.unidades.reduce((n, u) => n + u.semana.length + u.excecoes.length, 0)
  const p: PontuacaoAlvo = { total, acertos: 0, erros: [], aMais: [] }
  const usadas = new Set<number>()
  for (const e of exemplo.unidades) {
    const i = rascunho.unidades.findIndex((u, idx) => !usadas.has(idx) && u.unidade !== null && mesmoNome(u.unidade, e.unidade))
    if (i < 0) {
      p.erros.push(`${e.unidade}: unidade faltando`)
      continue
    }
    usadas.add(i)
    const u = rascunho.unidades[i]!
    for (const d of e.semana) {
      const lido = u.semana.find((x) => x.dia === d.dia)
      const esperado = turnosTexto(d.turnos)
      if (!lido) p.erros.push(`${e.unidade} dia ${d.dia}: faltando`)
      else if (turnosTexto(lido.turnos) !== esperado) p.erros.push(`${e.unidade} dia ${d.dia}: esperado ${esperado}, lido ${turnosTexto(lido.turnos)}`)
      else p.acertos++
    }
    for (const x of e.excecoes) {
      const lida = u.excecoes.find((y) => y.data === x.data)
      const esperado = turnosTexto(x.turnos)
      if (!lida) p.erros.push(`${e.unidade} ${x.data}: faltando`)
      else if (lida.fechado !== x.fechado || turnosTexto(lida.turnos) !== esperado) p.erros.push(`${e.unidade} ${x.data}: esperado ${esperado}, lido ${turnosTexto(lida.turnos)}`)
      else p.acertos++
    }
    const datas = new Set(e.excecoes.map((x) => x.data))
    p.aMais.push(...u.excecoes.filter((y) => !datas.has(y.data)).map((y) => `${e.unidade} ${y.data}`))
  }
  p.aMais.push(...rascunho.unidades.filter((_, idx) => !usadas.has(idx)).map((u) => `unidade ${u.unidade ?? '(sem nome)'}`))
  return p
}

/** Espaços: espaço com o nome e a unidade do gabarito e as duas capacidades exatas. */
export function pontuarEspacos(exemplo: ExemploEspacos, rascunho: RascunhoEspacos): PontuacaoAlvo {
  const p: PontuacaoAlvo = { total: exemplo.espacos.length, acertos: 0, erros: [], aMais: [] }
  const usados = new Set<number>()
  for (const e of exemplo.espacos) {
    const i = rascunho.espacos.findIndex((x, idx) => !usados.has(idx) && mesmoNome(x.nome, e.nome) && mesmaUnidade(x.unidade, e.unidade))
    if (i < 0) {
      p.erros.push(`${e.nome}: faltando`)
      continue
    }
    usados.add(i)
    const x = rascunho.espacos[i]!
    if (x.capacidadeMin === e.capacidadeMin && x.capacidadeMax === e.capacidadeMax) p.acertos++
    else p.erros.push(`${e.nome}: esperado ${e.capacidadeMin}-${e.capacidadeMax}, lido ${x.capacidadeMin}-${x.capacidadeMax}`)
  }
  p.aMais = rascunho.espacos.filter((_, idx) => !usados.has(idx)).map((x) => x.nome)
  return p
}
