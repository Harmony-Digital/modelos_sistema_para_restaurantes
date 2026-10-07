import { Inbox, UserRound } from 'lucide-react'
import Link from 'next/link'
import type { AbaInbox, ItemInbox } from '@atd/db'
import { SeloSimulacao } from '@/components/painel/selo-simulacao'
import { EmptyState } from '@/components/shell/empty-state'
import { Badge } from '@/components/ui/badge'
import { EtiquetaStatus, type VarianteEtiqueta } from '@/components/ui/etiqueta-status'
import { haQuanto, ROTULO_ESTADO, ROTULO_MOTIVO, VAZIO_INBOX } from '@/lib/conversas'
import { cn } from '@/lib/utils'

export { SeloSimulacao }

/** `atendenteId` (vem da DAL) marca as conversas do próprio usuário com "Você". */
export type ItemLista = ItemInbox

const VARIANTE_ESTADO: Record<ItemInbox['estado'], VarianteEtiqueta> = {
  aguardando_humano: 'aguarda',
  humano: 'humano',
  ia: 'ia',
  encerrada: 'encerrada',
}

export function SeloEstado({ estado }: { estado: ItemInbox['estado'] }) {
  return <EtiquetaStatus variante={VARIANTE_ESTADO[estado]}>{ROTULO_ESTADO[estado]}</EtiquetaStatus>
}


export function ListaConversas(props: {
  itens: ItemLista[]
  aba: AbaInbox
  meuId: string
  agora?: Date
  /** Conversa aberta ao lado (lista + detalhe): marcada com `aria-current`. */
  abertaId?: string | undefined
  /** Filtros da lista levados ao abrir uma conversa (ex.: `aba=ia&sim=1`). */
  busca?: string | undefined
}) {
  const agora = props.agora ?? new Date()
  if (props.itens.length === 0) {
    const v = VAZIO_INBOX[props.aba]
    return <EmptyState icon={Inbox} title={v.titulo} description={v.descricao} />
  }
  return (
    <ul data-lista-navegavel="" className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
      {props.itens.map((c) => {
        const meu = c.atendenteId != null && c.atendenteId === props.meuId
        const desde = c.estado === 'aguardando_humano' && c.aguardandoDesde ? c.aguardandoDesde : c.lastMessageAt
        const aberta = c.id === props.abertaId
        return (
          <li key={c.id} className={cn(meu && 'bg-secondary/40')}>
            <Link
              href={props.busca ? `/conversas/${c.id}?${props.busca}` : `/conversas/${c.id}`}
              aria-current={aberta ? 'page' : undefined}
              className={cn(
                'flex min-h-16 items-start gap-3 px-4 py-3 focus-visible:outline-offset-[-2px] [@media(hover:hover)]:hover:bg-accent',
                aberta && 'bg-accent/60 shadow-[inset_3px_0_0_var(--primary)]',
              )}
            >
              <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary">
                <UserRound aria-hidden="true" className="size-5" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-foreground">{c.nome ?? 'Cliente sem nome'}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{haQuanto(desde, agora)}</span>
                </span>
                <span className="truncate text-sm text-muted-foreground">{c.unidade ?? 'Unidade não definida'}</span>
                {c.trecho && <span className="line-clamp-2 break-words text-sm text-foreground">{c.trecho}</span>}
                <span className="mt-1 flex flex-wrap items-center gap-1.5">
                  <SeloEstado estado={c.estado} />
                  {c.simulada && <SeloSimulacao />}
                  {c.estado === 'aguardando_humano' && c.handoffMotivo && (
                    <span className="text-xs text-muted-foreground">{ROTULO_MOTIVO[c.handoffMotivo]}</span>
                  )}
                  {c.estado === 'humano' && (meu
                    ? <Badge className="bg-primary text-primary-foreground">Você</Badge>
                    : c.atendente && <span className="text-xs text-muted-foreground">Com {c.atendente}</span>)}
                </span>
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
