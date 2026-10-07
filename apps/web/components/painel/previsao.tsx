'use client'
import { CalendarCheck, ChevronLeft, ChevronRight, Plus, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { somarDias } from '@atd/core/s1'
import type { AvisoPainel, PrevisaoUnidade } from '@atd/db'
import { cancelarAvisoAction, criarAvisoAction } from '@/app/(painel)/agenda/actions'
import { EmptyState } from '@/components/shell/empty-state'
import { Badge } from '@/components/ui/badge'
import { EtiquetaStatus } from '@/components/ui/etiqueta-status'
import { SeloSimulacao } from './selo-simulacao'
import { Button } from '@/components/ui/button'
import { chamarAcao } from '@/lib/action-result'
import { dataBr, hrefPrevisao, inicioDaPrevisao, limiteDaPrevisao, resumoUnidade, rotuloDoDia } from '@/lib/previsao'
import { Abas } from './abas'
import { AvisoForm } from './aviso-form'
import { Confirmar } from './confirmar'
import { FolhaFormulario } from './folha-formulario'

const linkClass =
  'inline-flex size-11 items-center justify-center rounded-md border border-input transition-colors duration-150 [@media(hover:hover)]:hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
const desativado = 'inline-flex size-11 items-center justify-center rounded-md border border-input opacity-40'

export function Previsao(props: {
  data: string
  hoje: string
  unidades: PrevisaoUnidade[]
  /** Id da unidade escolhida no filtro (null = todas). */
  filtro: string | null
  mostrarCancelados: boolean
  podeEditar: boolean
}) {
  const router = useRouter()
  const [novo, setNovo] = useState(false)
  const [cancelando, setCancelando] = useState<AvisoPainel | null>(null)
  const limite = limiteDaPrevisao(props.hoje)
  const inicio = inicioDaPrevisao(props.hoje)
  // dia passado é só consulta: sem Novo aviso nem Cancelar
  const passado = props.data < props.hoje
  const podeEditar = props.podeEditar && !passado
  const href = (data: string, extra: { unidade?: string | null; cancelados?: boolean } = {}) =>
    hrefPrevisao({
      data, hoje: props.hoje,
      unidade: extra.unidade === undefined ? props.filtro ?? undefined : extra.unidade ?? undefined,
      cancelados: extra.cancelados ?? props.mostrarCancelados,
    })
  const anterior = props.data > inicio ? somarDias(props.data, -1) : null
  const proximo = props.data < limite ? somarDias(props.data, 1) : null
  const visiveis = props.filtro ? props.unidades.filter((u) => u.unitId === props.filtro) : props.unidades
  const totalAvisos = visiveis.reduce((s, u) => s + u.avisos.length, 0)
  const opcoes = props.unidades.map((u) => ({ id: u.unitId, nome: u.unidade }))
  const botaoNovo = podeEditar && props.unidades.length > 0 && (
    <Button className="self-start" onClick={() => setNovo(true)}>
      <Plus aria-hidden="true" className="size-4" /> Novo aviso
    </Button>
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        {anterior ? (
          <Link href={href(anterior)} aria-label="Dia anterior" className={linkClass}><ChevronLeft aria-hidden="true" className="size-5" /></Link>
        ) : (
          <span aria-hidden="true" className={desativado}><ChevronLeft className="size-5" /></span>
        )}
        <input
          type="date"
          aria-label="Escolher o dia"
          value={props.data}
          min={inicio}
          max={limite}
          onChange={(e) => e.target.value && router.push(href(e.target.value))}
          className="h-11 min-w-0 flex-1 rounded-md border border-input bg-card px-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {proximo ? (
          <Link href={href(proximo)} aria-label="Próximo dia" className={linkClass}><ChevronRight aria-hidden="true" className="size-5" /></Link>
        ) : (
          <span aria-hidden="true" className={desativado}><ChevronRight className="size-5" /></span>
        )}
      </div>
      <p className="font-medium text-foreground" aria-live="polite">{rotuloDoDia(props.data, props.hoje)}</p>
      {passado && <p className="text-sm text-muted-foreground">Dia passado: só consulta.</p>}

      {props.unidades.length > 1 && (
        <Abas
          rotulo="Filtrar por unidade"
          itens={[
            { href: href(props.data, { unidade: null }), rotulo: 'Todas', ativo: props.filtro === null },
            ...props.unidades.map((u) => ({ href: href(props.data, { unidade: u.unitId }), rotulo: u.unidade, ativo: props.filtro === u.unitId })),
          ]}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {botaoNovo || <span />}
        <Link
          href={href(props.data, { cancelados: !props.mostrarCancelados })}
          className="inline-flex min-h-11 items-center text-sm font-medium text-link underline-offset-4 [@media(hover:hover)]:hover:underline"
        >
          {props.mostrarCancelados ? 'Ocultar cancelados' : 'Mostrar cancelados'}
        </Link>
      </div>

      {props.unidades.length === 0 ? (
        <EmptyState icon={CalendarCheck} title="Cadastre uma unidade" description="Os avisos de presença aparecem aqui por unidade, depois que ela for cadastrada." />
      ) : totalAvisos === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title={props.data === props.hoje ? 'Nenhum aviso para hoje' : `Nenhum aviso para ${dataBr(props.data)}`}
          description={passado ? 'Ninguém avisou que viria neste dia.' : 'Quando um cliente avisar pelo WhatsApp, aparece aqui.'}
        />
      ) : null}

      {totalAvisos > 0 && (
        <div className="flex flex-col gap-5">
          {visiveis.map((u) => {
            const r = resumoUnidade(u)
            return (
              <section key={u.unitId} aria-labelledby={`un-${u.unitId}`} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <h2 id={`un-${u.unitId}`} className="font-display text-lg font-semibold">{u.unidade}</h2>
                  <p className="text-sm text-muted-foreground"><strong className="font-semibold text-foreground">{r.pessoas}</strong> · {r.avisos}</p>
                </div>
                {u.avisos.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum aviso nesta unidade.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {u.avisos.map((a) => (
                      <li key={a.id} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
                        <div className="min-w-0 flex-1">
                          <p className={`flex flex-wrap items-center gap-2 font-semibold text-foreground ${a.status === 'cancelado' ? 'line-through decoration-1' : ''}`}>
                            <span className="min-w-0 break-words">{a.nome ?? 'Sem nome'}</span>
                            {a.simulado && <SeloSimulacao />}
                          </p>
                          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                            <span>{a.pessoas === 1 ? '1 pessoa' : `${a.pessoas} pessoas`}</span>
                            {a.horarioAprox && <span>· {a.horarioAprox}</span>}
                            <Badge variant="secondary">{a.origem === 'ia' ? 'IA' : 'Painel'}</Badge>
                            {a.status === 'cancelado' && <EtiquetaStatus variante="cancelado">Cancelado</EtiquetaStatus>}
                          </p>
                        </div>
                        {podeEditar && a.status === 'ativo' && (
                          <Button variant="ghost" size="icon" aria-label={`Cancelar aviso de ${a.nome ?? 'sem nome'}, ${a.pessoas === 1 ? '1 pessoa' : `${a.pessoas} pessoas`}`} onClick={() => setCancelando(a)}>
                            <X aria-hidden="true" className="size-5" />
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      )}

      <FolhaFormulario aberto={novo} onAbertoChange={setNovo} titulo="Novo aviso" descricao="Para quando o cliente avisa por outro canal, como telefone ou balcão.">
        {novo && (
          <AvisoForm
            hoje={props.hoje}
            unidades={opcoes}
            inicial={{ unitId: props.filtro ?? (opcoes.length === 1 ? opcoes[0]!.id : ''), data: props.data, pessoas: '', horario: '', nome: '' }}
            acao={criarAvisoAction}
            onSalvo={() => setNovo(false)}
          />
        )}
      </FolhaFormulario>

      <Confirmar
        aberto={cancelando !== null}
        onAbertoChange={(a) => !a && setCancelando(null)}
        titulo="Cancelar este aviso?"
        descricao={cancelando ? `O aviso de ${cancelando.pessoas === 1 ? '1 pessoa' : `${cancelando.pessoas} pessoas`} sai da previsão do dia. O cliente não é avisado.` : ''}
        rotuloConfirmar="Cancelar aviso"
        rotuloAndamento="Cancelando…"
        onConfirmar={async () => {
          if (!cancelando) return
          const r = await chamarAcao(() => cancelarAvisoAction(cancelando.id))
          if (r.ok) toast.success('Aviso cancelado.')
          else toast.error(r.formError ?? 'Não foi possível cancelar. Tente de novo.')
          setCancelando(null)
          router.refresh()
        }}
      />
    </div>
  )
}
