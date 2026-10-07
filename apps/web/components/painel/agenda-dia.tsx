'use client'
import { CalendarCheck, ChevronLeft, ChevronRight, PartyPopper, Plus, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { somarDias } from '@atd/core/s1'
import { rotuloTipoEvento } from '@atd/core/s3'
import type { AvisoPainel, PedidoPainel, PrevisaoUnidade, StatusPedido } from '@atd/db'
import { cancelarAvisoAction, criarAvisoAction } from '@/app/(painel)/agenda/actions'
import { EmptyState } from '@/components/shell/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EtiquetaStatus } from '@/components/ui/etiqueta-status'
import { Numero } from '@/components/ui/numero'
import { chamarAcao } from '@/lib/action-result'
import {
  alternarStatus, ehHorarioHHMM, hrefAgenda, horarioDoAviso, inicioDaAgenda, limiteDaAgenda, linhaDoTempo, pendentesForaDoDia, resumoDoDia,
  statusDaAgenda, type ItemAgenda, type VerAgenda,
} from '@/lib/agenda'
import { dataDoEvento, haQuanto, ROTULO_STATUS, type MembroTela } from '@/lib/eventos'
import { STATUS_PEDIDO } from '@/lib/schemas/eventos'
import { dataBr, limiteDaPrevisao, rotuloDoDia } from '@/lib/previsao'
import { MIDIA_LG, useMidia } from '@/lib/use-midia'
import { cn } from '@/lib/utils'
import { Abas } from './abas'
import { AvisoForm } from './aviso-form'
import { Confirmar } from './confirmar'
import { FolhaFormulario } from './folha-formulario'
import { PedidoDetalhe } from './pedido-detalhe'
import { SeloSimulacao } from './selo-simulacao'
import { SeloStatus } from './selo-status'

const linkClass =
  'inline-flex size-11 items-center justify-center rounded-md border border-input transition-colors duration-150 [@media(hover:hover)]:hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
const desativado = 'inline-flex size-11 items-center justify-center rounded-md border border-input opacity-40'
const textoLink = 'inline-flex min-h-11 items-center text-sm font-medium text-link underline-offset-4 [@media(hover:hover)]:hover:underline'
const MAX_PENDENTES = 8
const chip =
  'inline-flex min-h-11 items-center whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
const linhaPedidoClass =
  'flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [@media(hover:hover)]:hover:bg-accent'

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`
const pessoas = (n: number) => plural(n, 'pessoa', 'pessoas')

export function AgendaDia(props: {
  dia: string
  hoje: string
  /** Unidades ativas visíveis, com os avisos do dia (`previsaoDoDia`). */
  unidades: PrevisaoUnidade[]
  /**
   * Pedidos de evento visíveis (`listarPedidos`), de qualquer dia e status: no dia, os do dia entram na linha do tempo
   * (recusados e cancelados só com "mostrar cancelados") e os pendentes de outros dias vão para a lista abaixo; em
   * "Todos os pedidos", os do filtro de status.
   */
  pedidos: PedidoPainel[]
  /** Id da unidade escolhida (null = todas). */
  unidade: string | null
  cancelados: boolean
  /** Pedido aberto (`?pedido=`). */
  pedidoId: string | null
  membros: MembroTela[]
  /** Dono e gerente anotam e cancelam avisos; o pedido de evento a equipe toda trabalha. */
  podeEditar: boolean
  /** Instante do carregamento ("há X horas" sem divergir na hidratação). */
  agora: Date
  /** `dia`: linha do tempo do dia; `pedidos`: todos os pedidos de evento, com filtro de status (a aba Eventos antiga). */
  ver: VerAgenda
  /** Filtro de status da lista de todos os pedidos. */
  status: StatusPedido[]
  /** Pedidos novos visíveis (contador da alternância). */
  novos: number
}) {
  const router = useRouter()
  // lg (≥ 1024 px): o detalhe do pedido fica ao lado; abaixo, em folha. null até saber (evita abrir a folha e trocar).
  const largo = useMidia(MIDIA_LG)
  const [novo, setNovo] = useState(false)
  const [cancelando, setCancelando] = useState<AvisoPainel | null>(null)

  const inicio = inicioDaAgenda(props.hoje)
  const limite = limiteDaAgenda(props.hoje)
  const passado = props.dia < props.hoje
  // aviso pelo painel: de hoje a +30 (mesma regra do formulário e da IA)
  const podeAnotar = props.podeEditar && !passado && props.dia <= limiteDaPrevisao(props.hoje)
  const href = (p: {
    dia?: string; unidade?: string | null; cancelados?: boolean; pedido?: string | null; ver?: VerAgenda; status?: StatusPedido[]
  } = {}) =>
    hrefAgenda({
      dia: p.dia ?? props.dia,
      hoje: props.hoje,
      unidade: p.unidade === undefined ? props.unidade : p.unidade,
      cancelados: p.cancelados ?? props.cancelados,
      ver: p.ver ?? props.ver,
      status: p.status ?? props.status,
      pedido: p.pedido === undefined ? null : p.pedido,
    })
  const anterior = props.dia > inicio ? somarDias(props.dia, -1) : null
  const proximo = props.dia < limite ? somarDias(props.dia, 1) : null

  const doDia = statusDaAgenda(props.cancelados)
  const itens = linhaDoTempo(props.unidades, props.pedidos.filter((p) => doDia.includes(p.status)), { dia: props.dia, unidade: props.unidade })
  const resumo = resumoDoDia(itens)
  const pendentes = pendentesForaDoDia(props.pedidos, props.dia)
  const fila = props.pedidos.filter((p) => props.status.includes(p.status))
  const pedido = props.pedidoId ? (props.pedidos.find((p) => p.id === props.pedidoId) ?? null) : null
  const mostrarUnidade = props.unidade === null && props.unidades.length > 1
  const opcoes = props.unidades.map((u) => ({ id: u.unitId, nome: u.unidade }))
  const fecharPedido = () => router.push(href(), { scroll: false })

  const secoes = (
    <Abas
      rotulo="Seções da agenda"
      itens={[
        { href: href({ ver: 'dia' }), rotulo: 'Dia', ativo: props.ver === 'dia' },
        {
          href: href({ ver: 'pedidos' }),
          rotulo: props.novos > 0 ? `Todos os pedidos (${props.novos} ${props.novos === 1 ? 'novo' : 'novos'})` : 'Todos os pedidos',
          ativo: props.ver === 'pedidos',
        },
      ]}
    />
  )
  const filtroUnidade = props.unidades.length > 1 && (
    <Abas
      rotulo="Filtrar por unidade"
      itens={[
        { href: href({ unidade: null }), rotulo: 'Todas', ativo: props.unidade === null },
        ...props.unidades.map((u) => ({ href: href({ unidade: u.unitId }), rotulo: u.unidade, ativo: props.unidade === u.unitId })),
      ]}
    />
  )

  const todos = (
    <div className="flex min-w-0 flex-col gap-4">
      {secoes}
      <nav aria-label="Filtrar por status" className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
        <ul className="flex gap-2">
          {STATUS_PEDIDO.map((s) => {
            const on = props.status.includes(s)
            return (
              <li key={s}>
                <Link
                  href={href({ status: alternarStatus(props.status, s) })}
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
      {filtroUnidade}
      {fila.length === 0 ? (
        <EmptyState
          icon={PartyPopper}
          title="Nenhum pedido de evento com esse status"
          description="Quando um cliente pedir um evento pelo WhatsApp, ele aparece nesta lista."
        />
      ) : (
        <ul aria-label="Todos os pedidos de evento" className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
          {fila.map((p) => (
            <li key={p.id} className="border-b border-border last:border-b-0">
              <Link
                href={href({ pedido: p.id })}
                scroll={false}
                aria-current={p.id === pedido?.id ? 'true' : undefined}
                className={cn(linhaPedidoClass, p.id === pedido?.id && 'bg-card shadow-[inset_3px_0_0_var(--primary)]')}
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="break-words font-semibold text-foreground">{p.nome ?? 'Sem nome'}</span>
                  <span className="text-muted-foreground">
                    {dataDoEvento(p.data)} · {plural(p.convidados, 'convidado', 'convidados')} · {rotuloTipoEvento(p.tipo, p.tipoTexto)}
                    {mostrarUnidade ? ` · ${p.unidade}` : ''}{p.espaco ? ` · ${p.espaco}` : ''} · {haQuanto(p.criadoEm, props.agora)}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {p.simulado && <SeloSimulacao />}
                  <SeloStatus status={p.status} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  const lista = (
    <div className="flex min-w-0 flex-col gap-4">
      {secoes}
      <div className="flex items-center gap-2 lg:max-w-md">
        {anterior ? (
          <Link href={href({ dia: anterior })} aria-label="Dia anterior" className={linkClass}><ChevronLeft aria-hidden="true" className="size-5" /></Link>
        ) : (
          <span aria-hidden="true" className={desativado}><ChevronLeft className="size-5" /></span>
        )}
        <input
          type="date"
          aria-label="Escolher o dia"
          value={props.dia}
          min={inicio}
          max={limite}
          onChange={(e) => e.target.value && router.push(href({ dia: e.target.value }))}
          className="h-11 min-w-0 flex-1 rounded-md border border-input bg-card px-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {proximo ? (
          <Link href={href({ dia: proximo })} aria-label="Próximo dia" className={linkClass}><ChevronRight aria-hidden="true" className="size-5" /></Link>
        ) : (
          <span aria-hidden="true" className={desativado}><ChevronRight className="size-5" /></span>
        )}
        {props.dia !== props.hoje && (
          <Link href={href({ dia: props.hoje })} className="inline-flex min-h-11 items-center rounded-md border border-input px-3 text-sm font-medium [@media(hover:hover)]:hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            Hoje
          </Link>
        )}
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-medium text-foreground" aria-live="polite">{rotuloDoDia(props.dia, props.hoje)}</p>
        {props.unidades.length > 0 && (
          <p data-testid="resumo-do-dia" className="text-sm text-muted-foreground">
            <strong className="font-semibold text-foreground"><Numero>{pessoas(resumo.pessoas)}</Numero></strong>
            {' · '}{plural(resumo.avisos, 'aviso', 'avisos')}{' · '}{plural(resumo.eventos, 'evento', 'eventos')}
          </p>
        )}
      </div>
      {passado && <p className="text-sm text-muted-foreground">Dia passado: só consulta.</p>}

      {filtroUnidade}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {podeAnotar && props.unidades.length > 0 ? (
          <Button onClick={() => setNovo(true)}>
            <Plus aria-hidden="true" className="size-4" /> Novo aviso
          </Button>
        ) : <span />}
        <Link href={href({ cancelados: !props.cancelados })} className={textoLink}>
          {props.cancelados ? 'Ocultar cancelados' : 'Mostrar cancelados'}
        </Link>
      </div>

      {props.unidades.length === 0 ? (
        <EmptyState icon={CalendarCheck} title="Cadastre uma unidade" description="Avisos de presença e pedidos de evento aparecem aqui depois que a unidade for cadastrada." />
      ) : itens.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title={props.dia === props.hoje ? 'Nada na agenda para hoje' : `Nada na agenda para ${dataBr(props.dia)}`}
          description={passado ? 'Ninguém avisou que viria nem pediu evento para este dia.' : 'Quando um cliente avisar que vem ou pedir um evento pelo WhatsApp, aparece aqui.'}
        />
      ) : (
        <ol aria-label="Linha do tempo do dia" className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
          {itens.map((i) => (
            <Linha
              key={i.chave}
              item={i}
              mostrarUnidade={mostrarUnidade}
              agora={props.agora}
              aberto={i.tipo === 'evento' && i.pedido.id === pedido?.id}
              hrefPedido={(id) => href({ pedido: id })}
              podeCancelar={podeAnotar}
              onCancelar={setCancelando}
            />
          ))}
        </ol>
      )}

      {pendentes.length > 0 && (
        <section aria-labelledby="agenda-pendentes" className="flex flex-col gap-2">
          <h2 id="agenda-pendentes" className="text-base font-semibold">Pedidos para responder em outros dias</h2>
          <ul className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
            {pendentes.slice(0, MAX_PENDENTES).map((p) => (
              <li key={p.id} className="border-b border-border last:border-b-0">
                <Link
                  href={hrefAgenda({ dia: p.data, hoje: props.hoje, unidade: props.unidade, cancelados: props.cancelados, pedido: p.id })}
                  className={linhaPedidoClass}
                >
                  <span className="min-w-0 break-words">
                    <span className="font-semibold text-foreground">{p.nome ?? 'Sem nome'}</span>
                    <span className="text-muted-foreground"> · {dataDoEvento(p.data)}{mostrarUnidade ? ` · ${p.unidade}` : ''}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    {p.simulado && <SeloSimulacao />}
                    <SeloStatus status={p.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {pendentes.length > MAX_PENDENTES && (
            <Link href={href({ ver: 'pedidos', status: ['novo', 'em_contato'] })} className={textoLink}>
              Ver todos os pedidos ({pendentes.length})
            </Link>
          )}
        </section>
      )}
    </div>
  )

  const aoSalvarPedido = () => {
    if (largo) router.refresh()
    else fecharPedido()
  }

  return (
    <>
      <div className={cn('flex flex-col gap-4', pedido && largo && 'lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(340px,400px)] lg:items-start lg:gap-6')}>
        {props.ver === 'pedidos' ? todos : lista}
        {pedido && largo === true && (
          <aside
            aria-labelledby="pedido-aberto"
            // abaixo da barra superior fixa (~57 px) ao rolar a página
            className="sticky top-[4.5rem] flex max-h-[calc(100dvh-5.5rem)] min-w-0 flex-col gap-4 overflow-y-auto rounded-lg border border-border bg-card p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-col gap-1">
                <h2 id="pedido-aberto" className="text-base font-semibold">Pedido de evento</h2>
                <p className="text-sm text-muted-foreground">Entre em contato com o cliente. A IA não confirma nada: a decisão é da equipe.</p>
              </div>
              <Link href={href()} scroll={false} aria-label="Fechar o pedido" className={linkClass}><X aria-hidden="true" className="size-5" /></Link>
            </div>
            <PedidoDetalhe key={pedido.id} pedido={pedido} membros={props.membros} onSalvo={aoSalvarPedido} />
          </aside>
        )}
      </div>

      {largo === false && (
        <FolhaFormulario
          aberto={pedido !== null}
          onAbertoChange={(a) => !a && fecharPedido()}
          titulo="Pedido de evento"
          descricao="Entre em contato com o cliente. A IA não confirma nada: a decisão é da equipe."
        >
          {pedido && <PedidoDetalhe key={pedido.id} pedido={pedido} membros={props.membros} onSalvo={aoSalvarPedido} />}
        </FolhaFormulario>
      )}

      <FolhaFormulario aberto={novo} onAbertoChange={setNovo} titulo="Novo aviso" descricao="Para quando o cliente avisa por outro canal, como telefone ou balcão.">
        {novo && (
          <AvisoForm
            hoje={props.hoje}
            unidades={opcoes}
            inicial={{ unitId: props.unidade ?? (opcoes.length === 1 ? opcoes[0]!.id : ''), data: props.dia, pessoas: '', horario: '', nome: '' }}
            acao={criarAvisoAction}
            onSalvo={() => setNovo(false)}
          />
        )}
      </FolhaFormulario>

      <Confirmar
        aberto={cancelando !== null}
        onAbertoChange={(a) => !a && setCancelando(null)}
        titulo="Cancelar este aviso?"
        descricao={cancelando ? `O aviso de ${pessoas(cancelando.pessoas)} sai da previsão do dia. O cliente não é avisado.` : ''}
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
    </>
  )
}

const linhaClass = 'grid min-h-11 grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5'

function Linha(props: {
  item: ItemAgenda
  mostrarUnidade: boolean
  agora: Date
  aberto: boolean
  hrefPedido: (id: string) => string
  podeCancelar: boolean
  onCancelar: (a: AvisoPainel) => void
}) {
  const i = props.item
  if (i.tipo === 'evento') {
    const p = i.pedido
    return (
      <li className="border-b border-border last:border-b-0">
        <Link
          href={props.hrefPedido(p.id)}
          scroll={false}
          aria-current={props.aberto ? 'true' : undefined}
          className={cn(
            linhaClass,
            'transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
            // etiqueta de sucesso ("Confirmado") só é AA sobre cartão ou tint leve: aberta = cartão + barra laranja
            props.aberto
              ? 'bg-card shadow-[inset_3px_0_0_var(--primary)]'
              : '[@media(hover:hover)]:hover:bg-accent/40',
          )}
        >
          <span className="font-mono text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dia todo</span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 break-words font-semibold text-foreground">{p.nome ?? 'Sem nome'}</span>
              {p.simulado && <SeloSimulacao />}
              <SeloStatus status={p.status} />
            </span>
            <span className="text-sm text-muted-foreground">
              Evento · {plural(p.convidados, 'convidado', 'convidados')} · {rotuloTipoEvento(p.tipo, p.tipoTexto)}
              {props.mostrarUnidade ? ` · ${p.unidade}` : ''}{p.espaco ? ` · ${p.espaco}` : ''} · {haQuanto(p.criadoEm, props.agora)}
            </span>
          </span>
          <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
        </Link>
      </li>
    )
  }
  const a = i.aviso
  const cancelado = a.status === 'cancelada'
  return (
    <li className={cn(linhaClass, 'border-b border-border last:border-b-0')}>
      {a.horarioAprox
        ? ehHorarioHHMM(a.horarioAprox)
          ? <Numero className="text-sm text-foreground">{horarioDoAviso(a.horarioAprox)}</Numero>
          : <span className="min-w-0 break-words text-sm text-foreground">{a.horarioAprox}</span>
        : <span className="font-mono text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sem hora</span>}
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={cn('flex flex-wrap items-center gap-2 font-semibold text-foreground', cancelado && 'line-through decoration-1')}>
          <span className="min-w-0 break-words">{a.nome ?? 'Sem nome'}</span>
          {a.simulado && <SeloSimulacao />}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span>Aviso · {pessoas(a.pessoas)}{props.mostrarUnidade ? ` · ${i.unidade}` : ''}</span>
          <Badge variant="secondary">{a.origem === 'ia' ? 'IA' : 'Painel'}</Badge>
          {cancelado && <EtiquetaStatus variante="cancelado">Cancelado</EtiquetaStatus>}
        </span>
      </span>
      {props.podeCancelar && !cancelado ? (
        <Button variant="ghost" size="icon" aria-label={`Cancelar aviso de ${a.nome ?? 'sem nome'}, ${pessoas(a.pessoas)}`} onClick={() => props.onCancelar(a)}>
          <X aria-hidden="true" className="size-5" />
        </Button>
      ) : <span />}
    </li>
  )
}
