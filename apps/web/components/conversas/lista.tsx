import { Inbox, UserRound } from 'lucide-react'
import Link from 'next/link'
import type { AbaInbox, ItemInbox } from '@atd/db'
import { EmptyState } from '@/components/shell/empty-state'
import { Badge } from '@/components/ui/badge'
import { haQuanto, ROTULO_ESTADO, ROTULO_MOTIVO, VAZIO_INBOX } from '@/lib/conversas'
import { cn } from '@/lib/utils'

/** `atendenteId` (vem da DAL) marca as conversas do próprio usuário com "Você". */
export type ItemLista = ItemInbox

const COR_ESTADO: Record<ItemInbox['estado'], string> = {
  aguardando_humano: 'border-warning text-warning',
  humano: 'border-info text-info',
  ia: 'border-success text-success',
  encerrada: 'border-border text-muted-foreground',
}

export function SeloEstado({ estado }: { estado: ItemInbox['estado'] }) {
  return <Badge variant="outline" className={COR_ESTADO[estado]}>{ROTULO_ESTADO[estado]}</Badge>
}

export function SeloSimulacao() {
  return <Badge variant="outline" className="border-border text-muted-foreground">Simulação</Badge>
}

export function ListaConversas(props: { itens: ItemLista[]; aba: AbaInbox; meuId: string; agora?: Date }) {
  const agora = props.agora ?? new Date()
  if (props.itens.length === 0) {
    const v = VAZIO_INBOX[props.aba]
    return <EmptyState icon={Inbox} title={v.titulo} description={v.descricao} />
  }
  return (
    <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
      {props.itens.map((c) => {
        const meu = c.atendenteId != null && c.atendenteId === props.meuId
        const desde = c.estado === 'aguardando_humano' && c.aguardandoDesde ? c.aguardandoDesde : c.lastMessageAt
        return (
          <li key={c.id} className={cn(meu && 'bg-secondary/40')}>
            <Link
              href={`/conversas/${c.id}`}
              className="flex min-h-16 items-start gap-3 px-4 py-3 focus-visible:outline-offset-[-2px] [@media(hover:hover)]:hover:bg-accent"
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
