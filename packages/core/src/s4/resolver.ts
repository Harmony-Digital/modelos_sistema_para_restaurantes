import { normalizeText } from '../normalize.ts'
import { encontrarUnidade } from '../s1/busca.ts'
import { renderModelo, type ChaveModelo } from '../s1/modelos.ts'
import { unidadesOrdenadas } from '../s1/resolver.ts'
import type { ContextoS1, ItemExtraido, Lacuna, TagCardapio, UnidadeS1 } from '../s1/tipos.ts'
import { comporTexto } from '../s2/resolver.ts'
import type { AcaoS4, ItemCardapioCore, ResultadoS4, ResumoCardapio } from './tipos.ts'

/** Até 3 itens com descrição; mais que isso, lista com nome e preço. */
const MAX_DETALHADOS = 3
/** Teto de itens listados numa resposta (igual ao da busca no banco). */
const MAX_LISTADOS = 8
/** Sem unidade e preços diferentes: o preço de cada unidade cabe numa linha só até 3 unidades (como o S1). */
const MAX_UNIDADES_SEM_LISTA = 3
export const LACUNA_CARDAPIO = 'cardapio'

/** "Opções {tag}:" */
const ROTULO_TAG: Readonly<Record<TagCardapio, string>> = {
  vegano: 'veganas',
  vegetariano: 'vegetarianas',
  sem_gluten: 'sem glúten',
  sem_lactose: 'sem lactose',
  infantil: 'infantis',
  bebida: 'de bebidas',
  sobremesa: 'de sobremesa',
}

const MILHAR = /\B(?=(\d{3})+(?!\d))/g

/** 5990 ⇒ "R$ 59,90"; 123456 ⇒ "R$ 1.234,56" (sem Intl: o mesmo texto em qualquer runtime). */
export function formatarPreco(centavos: number): string {
  const reais = Math.trunc(centavos / 100)
  const resto = String(Math.abs(centavos % 100)).padStart(2, '0')
  return `R$ ${String(reais).replace(MILHAR, '.')},${resto}`
}

const textoPreco = (c: number | null) => (c === null ? 'preço sob consulta' : formatarPreco(c))
const negrito = (nome: string) => `*${nome}*`
export const chaveLacunaCardapio = (termo: string | null) => `${LACUNA_CARDAPIO}:${normalizeText(termo ?? '').slice(0, 60) || 'geral'}`

/** Itens do cardápio por índice na lista de itens da mensagem (o worker busca antes de resolver). */
export type AchadosCardapio = ReadonlyMap<number, readonly ItemCardapioCore[]>

/** Resultado antes da composição (resolverAtendimento junta os trechos com S1–S3). */
export type ParcialS4 = Omit<ResultadoS4, 'texto'> & { trechos: string[] }

type PrecoDoItem =
  | { tipo: 'unico'; centavos: number | null }
  | { tipo: 'porUnidade'; precos: { unidade: UnidadeS1; centavos: number | null }[] }
  | { tipo: 'indisponivel' }

export function resolverItensS4(
  itens: readonly ItemExtraido[],
  ctx: ContextoS1,
  achados: AchadosCardapio,
  resumo: ResumoCardapio,
  temArquivo: (unitId: string | null) => boolean,
  escolhidaId?: string,
): ParcialS4 {
  const m = (chave: ChaveModelo, vars: Record<string, string> = {}) => renderModelo(chave, vars, ctx.modelos)
  const unidades = unidadesOrdenadas(ctx)
  const escolhida = escolhidaId ? (unidades.find((u) => u.id === escolhidaId) ?? null) : null

  const trechos: string[] = []
  const acoes: AcaoS4[] = []
  const pendenteUnidade: ItemExtraido[] = []
  const lacunas = new Map<string, Lacuna>()
  let validos = 0
  let respondidos = 0
  const lacuna = (chave: string, unitId: string | null) => lacunas.set(`${chave}|${unitId ?? ''}`, { chave, unitId })

  /** Preço efetivo (vindo do banco): na unidade pedida, ou o de cada unidade onde o item está disponível. */
  function precoDe(item: ItemCardapioCore, u: UnidadeS1 | null): PrecoDoItem {
    if (u) {
      const naUnidade = item.porUnidade.find((p) => p.unitId === u.id)
      return naUnidade?.disponivel ? { tipo: 'unico', centavos: naUnidade.precoCentavos } : { tipo: 'indisponivel' }
    }
    const precos = unidades.flatMap((un) => {
      const p = item.porUnidade.find((x) => x.unitId === un.id)
      return p?.disponivel ? [{ unidade: un, centavos: p.precoCentavos }] : []
    })
    if (precos.length === 0) return unidades.length ? { tipo: 'indisponivel' } : { tipo: 'unico', centavos: item.precoBaseCentavos }
    if (new Set(precos.map((p) => p.centavos)).size === 1) return { tipo: 'unico', centavos: precos[0]!.centavos }
    return { tipo: 'porUnidade', precos }
  }

  /** `*Nome* — descrição — R$ 59,90` (detalhado) · `*Nome* — R$ 59,90` · `*Nome*: Asa Sul R$ 59,90 · Asa Norte R$ 62,00` (negrito do WhatsApp) */
  function linha(item: ItemCardapioCore, preco: Exclude<PrecoDoItem, { tipo: 'indisponivel' }>, detalhado: boolean): string {
    if (preco.tipo === 'porUnidade') {
      return `${negrito(item.nome)}: ${preco.precos.map((p) => `${p.unidade.nome} ${textoPreco(p.centavos)}`).join(' · ')}`
    }
    const descricao = detalhado ? item.descricao?.trim() : null
    return [negrito(item.nome), descricao, textoPreco(preco.centavos)].filter(Boolean).join(' — ')
  }

  const lista = (linhas: readonly string[]) => linhas.map((l) => `• ${l}`).join('\n')

  /** Muitas unidades com preços diferentes e nenhuma citada: espera a escolha na lista "Ver unidades". */
  const precisaUnidade = (encontrados: readonly ItemCardapioCore[], u: UnidadeS1 | null) =>
    !u && unidades.length > MAX_UNIDADES_SEM_LISTA && encontrados.some((i) => precoDe(i, null).tipo === 'porUnidade')

  function naoEncontrado(termo: string | null, u: UnidadeS1 | null): void {
    lacuna(chaveLacunaCardapio(termo), u?.id ?? null)
    trechos.push(m('cardapio_nao_encontrado'))
  }

  function buscar(item: ItemExtraido, encontrados: readonly ItemCardapioCore[], u: UnidadeS1 | null): void {
    if (precisaUnidade(encontrados, u)) {
      pendenteUnidade.push(item) // conta quando o cliente escolher
      return
    }
    validos++
    const disponiveis: { item: ItemCardapioCore; preco: Exclude<PrecoDoItem, { tipo: 'indisponivel' }> }[] = []
    const indisponiveis: ItemCardapioCore[] = []
    for (const i of encontrados.slice(0, MAX_LISTADOS)) {
      const preco = precoDe(i, u)
      if (preco.tipo === 'indisponivel') indisponiveis.push(i)
      else disponiveis.push({ item: i, preco })
    }
    // indisponível só faz sentido na unidade pedida; sem unidade, a busca já não traz item indisponível em todas
    if (disponiveis.length === 0 && !(u && indisponiveis.length)) {
      naoEncontrado(item.consulta, u)
      return
    }
    respondidos++
    if (disponiveis.length) {
      const detalhado = disponiveis.length <= MAX_DETALHADOS
      const linhas = disponiveis.map((d) => linha(d.item, d.preco, detalhado))
      trechos.push(m('cardapio_item', { itens: linhas.length === 1 ? linhas[0]! : `\n${lista(linhas)}` }).replace(/ +\n/g, '\n'))
    }
    if (u) {
      for (const i of indisponiveis.slice(0, MAX_DETALHADOS)) trechos.push(m('cardapio_indisponivel', { unidade: u.nome, item: negrito(i.nome) }))
    }
  }

  function filtrar(item: ItemExtraido, tag: TagCardapio, encontrados: readonly ItemCardapioCore[], u: UnidadeS1 | null): void {
    if (precisaUnidade(encontrados, u)) {
      pendenteUnidade.push(item)
      return
    }
    validos++
    const linhas = encontrados.slice(0, MAX_LISTADOS).flatMap((i) => {
      const preco = precoDe(i, u)
      return preco.tipo === 'indisponivel' ? [] : [linha(i, preco, false)]
    })
    if (linhas.length === 0) {
      naoEncontrado(tag, u)
      return
    }
    respondidos++
    trechos.push(m('cardapio_filtro', { tag: ROTULO_TAG[tag], itens: lista(linhas) }))
  }

  function enviar(u: UnidadeS1 | null): void {
    validos++
    const unitId = u?.id ?? null
    if (temArquivo(unitId)) {
      if (!acoes.some((a) => a.unitId === unitId)) acoes.push({ tipo: 'enviar_arquivo', unitId })
      respondidos++
      trechos.push(m('cardapio_enviando'))
      return
    }
    const categorias = resumo.filter((c) => c.itens.length)
    if (categorias.length === 0) {
      lacuna(LACUNA_CARDAPIO, null)
      trechos.push(m('lacuna'))
      return
    }
    respondidos++
    const linhas = categorias.map((c) =>
      `${negrito(c.categoria)}: ${c.itens.slice(0, MAX_DETALHADOS).map((i) => `${i.nome} (${i.precoVaria ? 'preço varia por unidade' : textoPreco(i.precoCentavos)})`).join(', ')}`)
    trechos.push(m('cardapio_sem_arquivo', { categorias: lista(linhas) }))
  }

  itens.forEach((item, indice) => {
    if (item.servico !== 'cardapio') return
    const u = escolhida ?? encontrarUnidade(item.unidade, unidades)
    const consulta = item.consulta?.trim() ? item.consulta : null
    const encontrados = achados.get(indice) ?? []
    // sem tipo (ou tipo incoerente com os campos): decide pelo que veio — tag ⇒ filtro, consulta ⇒ busca, nada ⇒ envio
    if (item.tipo === 'filtro' && item.tag) filtrar(item, item.tag, encontrados, u)
    else if (consulta && item.tipo !== 'enviar') buscar(item, encontrados, u)
    else if (item.tag && item.tipo !== 'enviar') filtrar(item, item.tag, encontrados, u)
    else enviar(u)
  })

  return { trechos, acoes, lacunas: [...lacunas.values()], pendenteUnidade, validos, respondidos }
}

export function resolverS4(
  itens: readonly ItemExtraido[],
  ctx: ContextoS1,
  achados: AchadosCardapio,
  resumo: ResumoCardapio,
  temArquivo: (unitId: string | null) => boolean,
  escolhidaId?: string,
): ResultadoS4 {
  const { trechos, ...r } = resolverItensS4(itens, ctx, achados, resumo, temArquivo, escolhidaId)
  return { ...r, texto: comporTexto(trechos) }
}
