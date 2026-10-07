import { cn } from './utils'

/**
 * Lista + detalhe (Conversas, Unidades). ≥ lg: as duas colunas lado a lado, cada uma com rolagem própria e largura
 * mínima (cabem entre 1024 e 1280 px com o menu aberto). < lg: só a lista sem detalhe aberto; só o detalhe com ele.
 */
export function colunaLista(detalheAberto: boolean): string {
  return cn(
    'min-w-0 flex-col lg:flex lg:w-[20rem] lg:shrink-0 lg:overflow-y-auto lg:border-r lg:border-border xl:w-[24rem]',
    detalheAberto ? 'hidden' : 'flex',
  )
}

export function colunaDetalhe(aberto: boolean): string {
  return cn('min-w-0 flex-col lg:flex lg:min-w-[28rem] lg:flex-1 lg:overflow-y-auto', aberto ? 'flex' : 'hidden')
}

const FILTROS = ['aba', 'unidade', 'sim', 'cursor'] as const
type Busca = Record<string, string | string[] | undefined>

/** Só os filtros da lista (aba, unidade, simulações, página): abrir e fechar um item não perde a lista. */
export function buscaDaLista(sp: Busca): string {
  const q = new URLSearchParams()
  for (const k of FILTROS) {
    const v = sp[k]
    if (typeof v === 'string' && v !== '') q.set(k, v)
  }
  return q.toString()
}

export function hrefLista(base: string, sp: Busca, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams(buscaDaLista(sp))
  for (const [k, v] of Object.entries(extra)) q.set(k, v)
  const s = q.toString()
  return s ? `${base}?${s}` : base
}
