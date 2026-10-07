'use client'
import { Bot } from 'lucide-react'
import Link from 'next/link'
import { useTransition } from 'react'
import { toast } from 'sonner'
import { EsperaAoVivo } from '@/components/home/espera-ao-vivo'
import { SeloSimulacao } from '@/components/painel/selo-simulacao'
import { AoVivo } from '@/components/ui/ao-vivo'
import { Button } from '@/components/ui/button'
import { EtiquetaStatus } from '@/components/ui/etiqueta-status'
import { Tabela, TabelaCabecalho, TabelaCelula, TabelaCelulaCabecalho, TabelaCorpo, TabelaLinha } from '@/components/ui/tabela'
import { chamarAcao, type ActionResult } from '@/lib/action-result'

type Item = { id: string; nome: string | null; estado: 'aguardando_humano' | 'humano'; desde: Date; simulada: boolean }

const linkClass = 'inline-flex min-h-11 items-center text-sm font-medium text-link underline-offset-4 [@media(hover:hover)]:hover:underline'

/**
 * Fila "Aguardando atendimento" do Início: tabela com a situação em etiqueta e a espera em mm:ss ao vivo. A lista
 * em si chega pelo `router.refresh` do Realtime (Avisos, no layout); o cronômetro anda no navegador.
 */
export function AwaitingHuman(props: { itens: Item[]; action: (id: string) => Promise<ActionResult<null>> }) {
  const [pending, start] = useTransition()
  return (
    <section aria-labelledby="aguardando" className="flex min-w-0 flex-col rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-x-3 px-4 pt-2">
        <span className="flex items-center gap-2">
          <h2 id="aguardando" className="text-base font-semibold">Aguardando atendimento</h2>
          <AoVivo />
        </span>
        <Link href="/conversas" className={linkClass}>Abrir conversas</Link>
      </div>
      {props.itens.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground">Ninguém aguardando atendente</p>
      ) : (
        <Tabela aria-labelledby="aguardando" className="mt-1">
          <TabelaCabecalho>
            <tr>
              <TabelaCelulaCabecalho>Cliente</TabelaCelulaCabecalho>
              <TabelaCelulaCabecalho className="text-right">Espera</TabelaCelulaCabecalho>
              <TabelaCelulaCabecalho className="w-12"><span className="sr-only">Ações</span></TabelaCelulaCabecalho>
            </tr>
          </TabelaCabecalho>
          <TabelaCorpo>
            {props.itens.map((c) => {
              const nome = c.nome ?? 'Cliente sem nome'
              return (
                <TabelaLinha key={c.id}>
                  <TabelaCelula className="min-w-0">
                    <Link href={`/conversas/${c.id}`} className="block min-h-11 rounded-sm py-0.5 underline-offset-4 [@media(hover:hover)]:hover:underline">
                      <span className="block truncate font-medium text-foreground">{nome}</span>
                    </Link>
                    <span className="flex flex-wrap gap-1">
                      {c.estado === 'humano'
                        ? <EtiquetaStatus variante="humano">Em atendimento</EtiquetaStatus>
                        : <EtiquetaStatus variante="aguarda">Aguardando</EtiquetaStatus>}
                      {c.simulada && <SeloSimulacao />}
                    </span>
                  </TabelaCelula>
                  <TabelaCelula className="text-right align-top whitespace-nowrap text-foreground">
                    <span className="inline-flex min-h-11 items-center"><EsperaAoVivo desde={c.desde} /></span>
                  </TabelaCelula>
                  <TabelaCelula className="align-top">
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={pending}
                      aria-label={`Devolver à IA a conversa de ${nome}`}
                      title="Devolver à IA"
                      onClick={() => start(async () => {
                        const r = await chamarAcao(() => props.action(c.id))
                        if (r.ok) toast.success('Conversa devolvida à IA')
                        else toast.error(r.formError ?? 'Não foi possível devolver agora. Tente de novo.')
                      })}
                    >
                      <Bot aria-hidden="true" className="size-4" />
                    </Button>
                  </TabelaCelula>
                </TabelaLinha>
              )
            })}
          </TabelaCorpo>
        </Tabela>
      )}
    </section>
  )
}
