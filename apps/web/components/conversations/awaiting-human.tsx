'use client'
import { Bot, UserRound } from 'lucide-react'
import { useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

type Item = { id: string; nome: string | null; estado: 'aguardando_humano' | 'humano'; desde: Date }
type Resultado = 'devolvida' | 'ja_estava' | 'nao_encontrada'

const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' })
function haQuanto(d: Date) {
  const min = Math.round((Date.now() - new Date(d).getTime()) / 60_000)
  if (min < 60) return rtf.format(-Math.max(min, 1), 'minute')
  const h = Math.round(min / 60)
  return h < 24 ? rtf.format(-h, 'hour') : rtf.format(-Math.round(h / 24), 'day')
}

export function AwaitingHuman(props: { itens: Item[]; action: (id: string) => Promise<{ resultado: Resultado }> }) {
  const [pending, start] = useTransition()
  if (props.itens.length === 0) {
    return (
      <section aria-labelledby="aguardando" className="rounded-lg border border-border bg-card p-4">
        <h2 id="aguardando" className="text-base font-semibold">Aguardando atendente</h2>
        <p className="mt-1 text-sm text-muted-foreground">Ninguém aguardando atendente</p>
      </section>
    )
  }
  return (
    <section aria-labelledby="aguardando" className="rounded-lg border border-border bg-card p-4">
      <h2 id="aguardando" className="text-base font-semibold">Aguardando atendente</h2>
      <ul className="mt-3 divide-y divide-border">
        {props.itens.map((c) => {
          const nome = c.nome ?? 'Cliente sem nome'
          return (
            <li key={c.id} className="flex items-center justify-between gap-3 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary"><UserRound aria-hidden="true" className="size-5" /></span>
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{nome}</p>
                  <p className="text-sm text-muted-foreground">{c.estado === 'humano' ? 'Em atendimento' : 'Pediu atendente'} · {haQuanto(c.desde)}</p>
                </div>
              </div>
              <Button
                variant="secondary"
                disabled={pending}
                aria-label={`Devolver à IA a conversa de ${nome}`}
                onClick={() => start(async () => {
                  try {
                    const { resultado } = await props.action(c.id)
                    if (resultado === 'devolvida') toast.success('Conversa devolvida à IA')
                    else if (resultado === 'ja_estava') toast.info('Esta conversa já estava com a IA')
                    else toast.error('Conversa não encontrada')
                  } catch {
                    toast.error('Não foi possível devolver agora. Tente de novo.')
                  }
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
