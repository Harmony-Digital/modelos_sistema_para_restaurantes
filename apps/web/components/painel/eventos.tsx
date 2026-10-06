'use client'
import { PartyPopper } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { rotuloTipoEvento } from '@atd/core/s3'
import type { PedidoPainel, StatusPedido } from '@atd/db'
import { EmptyState } from '@/components/shell/empty-state'
import { alternarStatus, dataDoEvento, haQuanto, hrefEventos, ROTULO_STATUS, type MembroTela } from '@/lib/eventos'
import { STATUS_PEDIDO } from '@/lib/schemas/eventos'
import { cn } from '@/lib/utils'
import { Abas } from './abas'
import { FolhaFormulario } from './folha-formulario'
import { PedidoDetalhe } from './pedido-detalhe'
import { SeloStatus } from './selo-status'

const chip =
  'inline-flex min-h-11 items-center whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

export function Eventos(props: {
  pedidos: PedidoPainel[]
  /** Unidades que a pessoa pode ver. */
  unidades: { id: string; nome: string }[]
  status: StatusPedido[]
  unidade: string | null
  membros: MembroTela[]
  /** Instante do carregamento: "há X horas" é calculado a partir dele (evita divergência na hidratação). */
  agora: Date
}) {
  const router = useRouter()
  const [aberto, setAberto] = useState<string | null>(null)
  const pedido = props.pedidos.find((p) => p.id === aberto) ?? null

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Filtrar por status" className="-mx-4 overflow-x-auto px-4">
        <ul className="flex gap-2">
          {STATUS_PEDIDO.map((s) => {
            const on = props.status.includes(s)
            return (
              <li key={s}>
                <Link
                  href={hrefEventos({ status: alternarStatus(props.status, s), unidade: props.unidade })}
                  aria-current={on ? 'true' : undefined}
                  className={cn(chip, on ? 'border-transparent bg-secondary text-foreground' : 'border-border text-muted-foreground [@media(hover:hover)]:hover:text-foreground')}
                >
                  {ROTULO_STATUS[s]}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {props.unidades.length > 1 && (
        <Abas
          rotulo="Filtrar por unidade"
          itens={[
            { href: hrefEventos({ status: props.status, unidade: null }), rotulo: 'Todas', ativo: props.unidade === null },
            ...props.unidades.map((u) => ({ href: hrefEventos({ status: props.status, unidade: u.id }), rotulo: u.nome, ativo: props.unidade === u.id })),
          ]}
        />
      )}

      {props.pedidos.length === 0 ? (
        <EmptyState
          icon={PartyPopper}
          title="Nenhum pedido de evento por aqui"
          description="Quando um cliente pedir pelo WhatsApp, ele aparece nesta lista."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {props.pedidos.map((p) => {
            const tipo = rotuloTipoEvento(p.tipo, p.tipoTexto)
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setAberto(p.id)}
                  className="flex min-h-11 w-full flex-col gap-1 rounded-lg border border-border bg-card p-3 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [@media(hover:hover)]:hover:bg-accent"
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 break-words font-semibold text-foreground">{p.nome ?? 'Sem nome'}</span>
                    <SeloStatus status={p.status} />
                  </span>
                  <span className="text-sm text-foreground">{dataDoEvento(p.data)}</span>
                  <span className="text-sm text-muted-foreground">
                    {p.convidados === 1 ? '1 convidado' : `${p.convidados} convidados`} · {tipo}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {p.unidade}{p.espaco ? ` · ${p.espaco}` : ''} · {haQuanto(p.criadoEm, props.agora)}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <FolhaFormulario
        aberto={pedido !== null}
        onAbertoChange={(a) => !a && setAberto(null)}
        titulo="Pedido de evento"
        descricao="Entre em contato com o cliente. A IA não confirma nada: a decisão é da equipe."
      >
        {pedido && (
          <PedidoDetalhe
            key={pedido.id}
            pedido={pedido}
            membros={props.membros}
            onSalvo={() => {
              setAberto(null)
              router.refresh()
            }}
          />
        )}
      </FolhaFormulario>
    </div>
  )
}
