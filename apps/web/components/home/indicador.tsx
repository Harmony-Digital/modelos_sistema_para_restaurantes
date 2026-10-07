import { TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { Numero } from '@/components/ui/numero'
import { Minigrafico } from './minigrafico'

export type SerieIndicador = { valores: readonly number[]; rotulos: readonly string[]; descricao: string }

/**
 * Indicador da linha do topo do Início: rótulo em mono caixa-alta, valor em mono tabular e, onde houver série, o
 * mini-gráfico dos últimos 7 dias. Com `href`, o rótulo leva à tela do número (alvo de toque ≥ 44 px).
 */
export function Indicador(props: { rotulo: string; valor: string; dica?: string; href?: string; serie?: SerieIndicador; tom?: 'neutro' | 'alerta' }) {
  const rotulo = <span className="font-mono text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{props.rotulo}</span>
  return (
    <div role="group" aria-label={`${props.rotulo}: ${props.valor}`} className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3">
      {props.href ? (
        <Link href={props.href} className="-my-2 inline-flex min-h-11 w-fit items-center rounded-sm underline-offset-4 [@media(hover:hover)]:hover:underline">
          {rotulo}
        </Link>
      ) : rotulo}
      {props.tom === 'alerta' ? (
        // alerta não depende só de cor: ícone ao lado do valor (o nome do grupo já diz o número)
        <span className="flex min-w-0 items-center gap-1.5 text-destructive">
          <TriangleAlert aria-hidden="true" data-slot="alerta" className="size-5 shrink-0" />
          <Numero tamanho="lg" className="min-w-0 break-words text-destructive">{props.valor}</Numero>
        </span>
      ) : (
        <Numero tamanho="lg" className="min-w-0 break-words text-foreground">{props.valor}</Numero>
      )}
      {props.dica && <span className="text-xs text-muted-foreground">{props.dica}</span>}
      {props.serie && <Minigrafico {...props.serie} className="mt-1" />}
    </div>
  )
}
