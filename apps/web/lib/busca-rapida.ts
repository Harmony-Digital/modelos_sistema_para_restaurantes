import type { ResultadoBusca } from '@atd/db'
import type { StaffRole } from './access.ts'
import { gruposDoMenu, type ItemNav } from './navegacao.ts'

export type { ResultadoBusca }
/** Mínimo de caracteres para consultar o servidor (as telas filtram desde a primeira letra). */
export const MIN_TERMO_BUSCA = 2

/** Minúsculas, sem acento e sem espaços nas pontas: "Conteúdo" e "conteudo" se acham. */
export function normalizarBusca(t: string): string {
  return t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()
}

/** Telas do menu que o papel vê, filtradas pelo termo (no rótulo da tela, nas palavras dela ou no rótulo do grupo). */
export function telasDaBusca(papel: StaffRole, termo: string): ItemNav[] {
  const t = normalizarBusca(termo)
  const acha = (texto: string) => normalizarBusca(texto).includes(t)
  return gruposDoMenu(papel).flatMap((g) =>
    g.itens.filter((i) => !t || acha(i.rotulo) || (i.palavras ?? []).some(acha) || acha(g.rotulo ?? '')))
}

/** Onde cada resultado aparece no painel. */
export function hrefDoResultado(r: ResultadoBusca): string {
  switch (r.tipo) {
    case 'unidade': return `/unidades/${r.id}`
    case 'item': return '/conteudo?aba=cardapio'
    case 'informacao': return '/conteudo?aba=informacoes'
    case 'conversa': return `/conversas/${r.id}`
  }
}
