import { normalizeText } from '../normalize.ts'
import { LIMITES_RASCUNHO as L, rascunhoSchema, type ItemRascunho, type RascunhoCardapio } from './rascunho.ts'

export type ErroCsv = { linha: number; mensagem: string }

const COLUNAS = ['categoria', 'nome', 'descricao', 'preco', 'tags', 'outros_nomes', 'unidade'] as const
type Coluna = (typeof COLUNAS)[number]

/** "Preço", "descrição", "Outros nomes" ⇒ preco, descricao, outros_nomes. */
const nomeDaColuna = (h: string) => normalizeText(h).replace(/ /g, '_')

/** "Sem Glúten" ⇒ sem_gluten (mesma forma das tags conhecidas). */
const normalizarTag = (t: string) => normalizeText(t).replace(/ /g, '_')

const separarLista = (v: string) => v.split('|').map((s) => s.trim()).filter(Boolean)

/**
 * Preço da planilha em centavos: "59,90", "59.90", "59", "R$ 1.234,56", "1,234.56", "1.234"; vazio ⇒ null (sob consulta).
 * Ambíguo ("5,999", "1,234") ou fora de 0..R$ 100.000,00 ⇒ inválido.
 */
export function lerPrecoCsv(valor: string): { ok: true; centavos: number | null } | { ok: false } {
  const t = valor.replace(/R\$/gi, '').replace(/\s/g, '')
  if (!t) return { ok: true, centavos: null }
  let inteiro: string
  let decimal = ''
  let m: RegExpExecArray | null
  if (/^\d+$/.test(t)) inteiro = t
  else if ((m = /^(\d{1,3}(?:\.\d{3})+|\d+),(\d{1,2})$/.exec(t))) [inteiro, decimal] = [m[1]!.replace(/\./g, ''), m[2]!]
  else if ((m = /^(\d{1,3}(?:,\d{3})+|\d+)\.(\d{1,2})$/.exec(t))) [inteiro, decimal] = [m[1]!.replace(/,/g, ''), m[2]!]
  else if (/^\d{1,3}(?:\.\d{3})+$/.test(t)) inteiro = t.replace(/\./g, '')
  else return { ok: false }
  const centavos = Number(inteiro) * 100 + Number(decimal.padEnd(2, '0'))
  return Number.isSafeInteger(centavos) && centavos <= L.precoMax ? { ok: true, centavos } : { ok: false }
}

type Registro = { linha: number; campos: string[] }

/** RFC 4180 tolerante: aspas duplas com "" de escape e quebra de linha dentro de aspas. */
function lerRegistros(texto: string, sep: string): { registros: Registro[]; aspasSemFechar: number | null } {
  const registros: Registro[] = []
  let campos: string[] = []
  let campo = ''
  let aspas = false
  let linha = 1
  let inicio = 1
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i]!
    if (aspas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') {
          campo += '"'
          i++
        } else aspas = false
        continue
      }
      if (ch === '\n') linha++
      campo += ch
      continue
    }
    if (ch === '"' && campo.trim() === '') {
      aspas = true
      campo = ''
    } else if (ch === sep) {
      campos.push(campo)
      campo = ''
    } else if (ch === '\n') {
      campos.push(campo)
      registros.push({ linha: inicio, campos })
      campos = []
      campo = ''
      linha++
      inicio = linha
    } else campo += ch
  }
  if (aspas) return { registros, aspasSemFechar: inicio }
  if (campo !== '' || campos.length) registros.push({ linha: inicio, campos: [...campos, campo] })
  return { registros, aspasSemFechar: null }
}

/** O separador é o mais frequente (fora de aspas) na primeira linha com conteúdo: `;` (Excel pt-BR) ou `,`. */
function detectarSeparador(texto: string): string {
  const primeira = texto.split('\n').find((l) => l.trim()) ?? ''
  const fora = primeira.replace(/"[^"]*"/g, '')
  return (fora.match(/;/g)?.length ?? 0) > (fora.match(/,/g)?.length ?? 0) ? ';' : ','
}

type Lido = { categoria: string; item: ItemRascunho } | { erro: string }

function lerLinha(get: (c: Coluna) => string): Lido {
  const categoria = get('categoria')
  const nome = get('nome')
  if (!categoria) return { erro: 'categoria vazia.' }
  if (categoria.length > L.nome) return { erro: `categoria com mais de ${L.nome} caracteres.` }
  if (!nome) return { erro: 'nome vazio.' }
  if (nome.length > L.nome) return { erro: `nome com mais de ${L.nome} caracteres.` }
  const descricao = get('descricao')
  if (descricao.length > L.descricao) return { erro: `descrição com mais de ${L.descricao} caracteres.` }
  const preco = lerPrecoCsv(get('preco'))
  if (!preco.ok) return { erro: 'preço inválido.' }
  const tags = [...new Set(separarLista(get('tags')).map(normalizarTag).filter(Boolean))]
  if (tags.length > L.tags) return { erro: `no máximo ${L.tags} tags.` }
  if (tags.some((t) => t.length > L.tag)) return { erro: `tag com mais de ${L.tag} caracteres.` }
  const outrosNomes = separarLista(get('outros_nomes'))
  if (outrosNomes.length > L.outrosNomes) return { erro: `no máximo ${L.outrosNomes} outros nomes.` }
  if (outrosNomes.some((n) => n.length > L.nome)) return { erro: `outro nome com mais de ${L.nome} caracteres.` }
  const unidade = get('unidade')
  if (unidade.length > L.unidade) return { erro: `unidade com mais de ${L.unidade} caracteres.` }
  return {
    categoria,
    item: { nome, descricao: descricao || null, precoCentavos: preco.centavos, tags, outrosNomes, unidade: unidade || null, incluir: true },
  }
}

/**
 * Lê a planilha do cardápio (sem IA) no mesmo rascunho da importação por IA. Colunas pelo cabeçalho (obrigatório,
 * com `categoria` e `nome`): categoria, nome, descricao, preco, tags, outros_nomes, unidade. Separador `,` ou `;`;
 * tags e outros nomes separados por `|`. Linhas com erro ficam de fora e voltam em `erros` ("Linha 12: preço inválido.").
 */
export function lerCsvCardapio(texto: string): { rascunho: RascunhoCardapio; erros: ErroCsv[] } {
  const limpo = texto.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const erros: ErroCsv[] = []
  const erro = (linha: number, mensagem: string) => erros.push({ linha, mensagem: `Linha ${linha}: ${mensagem}` })
  const vazio = (): { rascunho: RascunhoCardapio; erros: ErroCsv[] } => ({ rascunho: { categorias: [] }, erros })

  const { registros, aspasSemFechar } = lerRegistros(limpo, detectarSeparador(limpo))
  const comConteudo = registros.filter((r) => r.campos.some((c) => c.trim()))
  const [cabecalho, ...linhas] = comConteudo
  if (!cabecalho) {
    erro(1, 'arquivo vazio.')
    return vazio()
  }
  const indice = new Map<Coluna, number>()
  for (const [i, h] of cabecalho.campos.entries()) {
    const col = COLUNAS.find((c) => c === nomeDaColuna(h))
    if (!col) continue // coluna desconhecida: ignorada
    if (indice.has(col)) {
      erro(cabecalho.linha, `coluna "${col}" repetida.`)
      return vazio()
    }
    indice.set(col, i)
  }
  if (!indice.has('categoria') || !indice.has('nome')) {
    erro(cabecalho.linha, 'cabeçalho deve ter as colunas categoria e nome.')
    return vazio()
  }

  const categorias = new Map<string, { nome: string; itens: ItemRascunho[] }>()
  const vistos = new Map<string, number>()
  let total = 0
  for (const r of linhas) {
    if (r.campos.slice(cabecalho.campos.length).some((c) => c.trim())) {
      erro(r.linha, 'colunas a mais que o cabeçalho.')
      continue
    }
    const lido = lerLinha((c) => {
      const i = indice.get(c)
      return i === undefined ? '' : (r.campos[i] ?? '').trim()
    })
    if ('erro' in lido) {
      erro(r.linha, lido.erro)
      continue
    }
    const chaveCategoria = normalizeText(lido.categoria)
    const chave = `${chaveCategoria}|${normalizeText(lido.item.nome)}|${normalizeText(lido.item.unidade ?? '')}`
    const anterior = vistos.get(chave)
    if (anterior !== undefined) {
      erro(r.linha, `item repetido (linha ${anterior}).`)
      continue
    }
    let categoria = categorias.get(chaveCategoria)
    if (!categoria && categorias.size >= L.categorias) {
      erro(r.linha, `limite de ${L.categorias} categorias.`)
      continue
    }
    if (total >= L.itens) {
      erro(r.linha, `limite de ${L.itens} itens.`)
      continue
    }
    if (!categoria) {
      categoria = { nome: lido.categoria, itens: [] }
      categorias.set(chaveCategoria, categoria)
    }
    categoria.itens.push(lido.item)
    vistos.set(chave, r.linha)
    total++
  }
  if (aspasSemFechar !== null) erro(aspasSemFechar, 'aspas sem fechar.')
  else if (linhas.length === 0) erro(cabecalho.linha, 'nenhum item na planilha.')
  // o mesmo schema da importação por IA e da revisão (falha aqui é bug do leitor, não da planilha)
  return { rascunho: rascunhoSchema.parse({ categorias: [...categorias.values()] }), erros }
}
