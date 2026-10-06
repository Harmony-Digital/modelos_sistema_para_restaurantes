import type { ItemExtraido, Lacuna } from '../s1/tipos.ts'

export { TAGS_CARDAPIO, TIPOS_S4, type TagCardapio, type TipoS4 } from '../s1/tipos.ts'

/** Preço e disponibilidade **efetivos** do item numa unidade ativa (exceção da unidade, senão o do item). */
export type PrecoNaUnidadeCore = { unitId: string; disponivel: boolean; precoCentavos: number | null }

/** Item do cardápio encontrado pela busca do banco (mesmo formato de `ItemEncontrado` de @atd/db, sem `rank`). */
export type ItemCardapioCore = {
  id: string
  nome: string
  descricao: string | null
  categoria: string
  tags: string[]
  /** centavos; null = "preço sob consulta" */
  precoBaseCentavos: number | null
  porUnidade: PrecoNaUnidadeCore[]
}

/** Resumo para quando não há arquivo: categorias ativas em ordem, até 3 itens cada (mesmo formato de @atd/db). */
export type ResumoCardapio = {
  categoria: string
  /** `precoVaria`: sem unidade, o preço efetivo difere entre as unidades (o texto não mostra preço) */
  itens: { nome: string; precoCentavos: number | null; precoVaria?: boolean }[]
}[]

/** O que o worker executa: envia o arquivo ativo da unidade (senão o geral). */
export type AcaoS4 = { tipo: 'enviar_arquivo'; unitId: string | null }

export type ResultadoS4 = {
  texto: string | null
  acoes: AcaoS4[]
  lacunas: Lacuna[]
  /** itens S4 que esperam a escolha da unidade na lista do S1 (preços diferentes entre muitas unidades) */
  pendenteUnidade: ItemExtraido[]
  validos: number
  respondidos: number
}
