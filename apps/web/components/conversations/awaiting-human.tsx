'use client'
import { Bot, UserRound } from 'lucide-react'
import Link from 'next/link'
import { useTransition } from 'react'
import { toast } from 'sonner'
import { SeloSimulacao } from '@/components/painel/selo-simulacao'
import { Button } from '@/components/ui/button'
import { chamarAcao, type ActionResult } from '@/lib/action-result'
import { haQuanto } from '@/lib/conversas'

type Item = { id: string; nome: string | null; estado: 'aguardando_humano' | 'humano'; desde: Date; simulada: boolean }

const linkClass = 'inline-flex min-h-11 items-center text-sm font-medium text-link underline-offset-4 [@media(hover:hover)]:hover:underline'

function Cabecalho() {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 id="aguardando" className="text-base font-semibold">Aguardando atendente</h2>
      <Link href="/conversas" className={linkClass}>Abrir conversas</Link>
    </div>
  )
}

export function AwaitingHuman(props: { itens: Item[]; action: (id: string) => Promise<ActionResult<null>> }) {
  const [pending, start] = useTransition()
  if (props.itens.length === 0) {
    return (
      <section aria-labelledby="aguardando" className="rounded-lg border border-border bg-card p-4">
        <Cabecalho />
        <p className="mt-1 text-sm text-muted-foreground">Ninguém aguardando atendente</p>
      </section>
    )
  }
  return (
    <section aria-labelledby="aguardando" className="rounded-lg border border-border bg-card p-4">
      <Cabecalho />
      <ul className="mt-3 divide-y divide-border">
        {props.itens.map((c) => {
          const nome = c.nome ?? 'Cliente sem nome'
          return (
            <li key={c.id} className="flex items-center justify-between gap-3 py-3">
              <Link href={`/conversas/${c.id}`} className="flex min-w-0 items-center gap-3 rounded-md">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary"><UserRound aria-hidden="true" className="size-5" /></span>
                <span className="min-w-0">
                  <span className="flex min-w-0 items-center gap-2"><span className="truncate font-medium text-foreground">{nome}</span>{c.simulada && <SeloSimulacao />}</span>
                  <span className="block text-sm text-muted-foreground">{c.estado === 'humano' ? 'Em atendimento' : 'Pediu atendente'} · {haQuanto(c.desde)}</span>
                </span>
              </Link>
              <Button
                variant="secondary"
                disabled={pending}
                aria-label={`Devolver à IA a conversa de ${nome}`}
                onClick={() => start(async () => {
                  const r = await chamarAcao(() => props.action(c.id))
                  if (r.ok) toast.success('Conversa devolvida à IA')
                  else toast.error(r.formError ?? 'Não foi possível devolver agora. Tente de novo.')
                })}
              >
                <Bot aria-hidden="true" className="size-4" /> Devolver à IA
              </Button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
