import Link from 'next/link'
import { SeloSimulacao } from '@/components/painel/selo-simulacao'
import { SeloStatus } from '@/components/painel/selo-status'
import { Numero } from '@/components/ui/numero'
import { Tabela, TabelaCabecalho, TabelaCelula, TabelaCelulaCabecalho, TabelaCorpo, TabelaLinha } from '@/components/ui/tabela'
import { ehHorarioHHMM, horarioDoAviso } from '@/lib/agenda'
import type { LinhaAgendaHoje } from '@/lib/inicio'

const LINK = 'inline-flex min-h-11 items-center text-sm font-medium text-link underline-offset-4 [@media(hover:hover)]:hover:underline'

/** Coluna "Agenda de hoje" do Início: reservas e pedidos de evento do dia; cada linha abre o item na Agenda. */
export function AgendaHoje(props: { linhas: readonly LinhaAgendaHoje[]; hoje: string }) {
  return (
    <section aria-labelledby="agenda-hoje" className="flex min-w-0 flex-col rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-3 px-4 pt-2">
        <h2 id="agenda-hoje" className="text-base font-semibold">Agenda de hoje</h2>
        <Link href={`/agenda?dia=${props.hoje}`} className={LINK}>Abrir agenda</Link>
      </div>
      {props.linhas.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground">Nenhuma reserva ou evento para hoje</p>
      ) : (
        <Tabela aria-labelledby="agenda-hoje" className="mt-1">
          <TabelaCabecalho>
            <tr>
              <TabelaCelulaCabecalho className="w-16">Hora</TabelaCelulaCabecalho>
              <TabelaCelulaCabecalho>Reserva ou evento</TabelaCelulaCabecalho>
            </tr>
          </TabelaCabecalho>
          <TabelaCorpo>
            {props.linhas.map((l) => (
              <TabelaLinha key={`${l.tipo}:${l.id}`}>
                <TabelaCelula className="align-top">
                  {l.hora
                    ? ehHorarioHHMM(l.hora)
                      ? <Numero className="whitespace-nowrap text-foreground">{horarioDoAviso(l.hora)}</Numero>
                      : <span className="block break-words text-sm text-foreground">{l.hora}</span>
                    : <span className="text-muted-foreground"><span aria-hidden="true">—</span><span className="sr-only">sem horário</span></span>}
                </TabelaCelula>
                <TabelaCelula className="min-w-0">
                  <Link href={l.href} className="block min-h-11 rounded-sm py-0.5 underline-offset-4 [@media(hover:hover)]:hover:underline">
                    <span className="block font-medium text-foreground">{l.titulo}</span>
                    <span className="block text-xs text-muted-foreground">{l.detalhe} · {l.unidade}</span>
                  </Link>
                  {(l.tipo === 'evento' || l.simulado) && (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {l.tipo === 'evento' && <SeloStatus status={l.status} />}
                      {l.simulado && <SeloSimulacao />}
                    </span>
                  )}
                </TabelaCelula>
              </TabelaLinha>
            ))}
          </TabelaCorpo>
        </Tabela>
      )}
    </section>
  )
}
