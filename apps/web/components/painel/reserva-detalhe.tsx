'use client'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import type { AvisoPainel, StatusReserva } from '@atd/db'
import { mudarStatusReservaAction, revelarContatoReservaAction } from '@/app/(painel)/agenda/actions'
import { Button } from '@/components/ui/button'
import { Numero } from '@/components/ui/numero'
import { chamarAcao } from '@/lib/action-result'
import { acoesDaReserva, ehHorarioHHMM, horaDaReserva, horarioDoAviso, ROTULO_STATUS_RESERVA } from '@/lib/agenda'
import { linksTelefone, telefoneLegivel } from '@/lib/eventos'
import { dataBr } from '@/lib/previsao'
import { SeloSimulacao } from './selo-simulacao'
import { SeloStatusReserva } from './selo-status'

const linkClass =
  'inline-flex min-h-11 items-center rounded-md border border-input px-4 text-sm font-medium text-link underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [@media(hover:hover)]:hover:bg-accent'
const ORDEM: readonly StatusReserva[] = ['confirmada', 'cancelada', 'nao_veio']
const ORIGEM_CONTATO = { informado: 'Número informado pelo cliente', whatsapp: 'WhatsApp de onde o cliente reservou' } as const

function Contato({ reservaId }: { reservaId: string }) {
  // o número vive só neste estado: some quando o detalhe fecha (o componente desmonta)
  const [contato, setContato] = useState<{ telefone: string; origem: 'informado' | 'whatsapp' } | null>(null)
  const [buscando, setBuscando] = useState(false)
  const andando = useRef(false)
  const ver = async () => {
    if (andando.current) return
    andando.current = true
    setBuscando(true)
    try {
      const r = await chamarAcao(() => revelarContatoReservaAction(reservaId))
      if (r.ok && r.data) setContato(r.data)
      else toast.error(r.ok ? 'Não foi possível mostrar o contato.' : (r.formError ?? 'Não foi possível mostrar o contato.'))
    } finally {
      andando.current = false
      setBuscando(false)
    }
  }
  if (contato === null) {
    return (
      <div className="flex flex-col gap-1.5">
        <Button type="button" variant="outline" className="self-start" aria-busy={buscando || undefined} disabled={buscando} onClick={ver}>
          Ver contato
        </Button>
        <p className="text-sm text-muted-foreground">Cada consulta ao contato fica registrada.</p>
      </div>
    )
  }
  const { tel, wa } = linksTelefone(contato.telefone)
  return (
    <div className="flex flex-col gap-2">
      <p className="flex flex-col gap-0.5">
        <span className="font-medium text-foreground">{telefoneLegivel(contato.telefone)}</span>
        <span className="text-sm text-muted-foreground">{ORIGEM_CONTATO[contato.origem]}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        <a href={tel} className={linkClass}>Ligar</a>
        <a href={wa} target="_blank" rel="noopener noreferrer" className={linkClass}>Abrir no WhatsApp</a>
        <Button type="button" variant="ghost" onClick={() => setContato(null)}>Ocultar contato</Button>
      </div>
    </div>
  )
}

/**
 * Detalhe da reserva (ao lado da linha do tempo no desktop; em folha no celular): dados, "Ver contato" auditado (toda a
 * equipe que vê a unidade) e as ações Confirmada, Cancelada e Não veio (dono e gerente). Reconfirmar sem vaga mostra a
 * mensagem do servidor aqui mesmo e nada muda.
 */
export function ReservaDetalhe(props: {
  reserva: AvisoPainel
  unidade: string
  /** Dia da reserva (o da Agenda aberta). */
  dia: string
  hoje: string
  podeEditar: boolean
  /** Depois de mudar a situação (com a nova). */
  onMudou: (status: StatusReserva) => void
}) {
  const r = props.reserva
  const [erro, setErro] = useState<string | null>(null)
  const [mudando, setMudando] = useState<StatusReserva | null>(null)
  const andando = useRef(false)
  const possiveis = acoesDaReserva(r.status, props.dia, props.hoje)
  const hora = horaDaReserva(r)
  const mudar = async (status: StatusReserva) => {
    if (andando.current) return
    andando.current = true
    setMudando(status)
    setErro(null)
    try {
      const res = await chamarAcao(() => mudarStatusReservaAction(r.id, status))
      if (!res.ok) {
        setErro(res.formError ?? 'Não foi possível mudar a situação. Tente de novo.')
        return
      }
      toast.success(`Reserva marcada como “${ROTULO_STATUS_RESERVA[status]}”.`)
      props.onMudou(status)
    } finally {
      andando.current = false
      setMudando(null)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Nome</dt>
        <dd className="flex flex-wrap items-center gap-2 break-words font-medium text-foreground">{r.nome ?? 'Sem nome'}{r.simulado && <SeloSimulacao />}</dd>
        <dt className="text-muted-foreground">Situação</dt><dd><SeloStatusReserva status={r.status} /></dd>
        <dt className="text-muted-foreground">Unidade</dt><dd className="text-foreground">{props.unidade}</dd>
        <dt className="text-muted-foreground">Dia</dt><dd className="text-foreground">{dataBr(props.dia)}</dd>
        <dt className="text-muted-foreground">Horário</dt>
        <dd className="break-words text-foreground">
          {hora ? (ehHorarioHHMM(hora) ? <Numero>{horarioDoAviso(hora)}</Numero> : hora) : 'Sem horário'}
        </dd>
        <dt className="text-muted-foreground">Pessoas</dt><dd className="text-foreground">{r.pessoas === 1 ? '1 pessoa' : `${r.pessoas} pessoas`}</dd>
        <dt className="text-muted-foreground">Origem</dt><dd className="text-foreground">{r.origem === 'ia' ? 'Pela IA, no WhatsApp' : 'Anotada no painel'}</dd>
      </dl>

      {r.temContato ? <Contato key={r.id} reservaId={r.id} /> : <p className="text-sm text-muted-foreground">Sem telefone de contato.</p>}

      {props.podeEditar && (
        <div className="flex flex-col gap-2">
          <div role="group" aria-label="Mudar a situação" className="flex flex-wrap gap-2">
            {ORDEM.map((s) => {
              const atual = s === r.status
              return (
                <Button
                  key={s}
                  type="button"
                  variant={atual ? 'secondary' : 'outline'}
                  aria-pressed={atual}
                  aria-busy={mudando === s || undefined}
                  disabled={atual || !possiveis.includes(s) || mudando !== null}
                  onClick={() => mudar(s)}
                >
                  {ROTULO_STATUS_RESERVA[s]}
                </Button>
              )
            })}
          </div>
          {r.status !== 'nao_veio' && props.dia > props.hoje && (
            <p className="text-sm text-muted-foreground">“Não veio” fica disponível no dia da reserva.</p>
          )}
          <p className="text-sm text-muted-foreground">Cancelada e Não veio liberam as vagas na hora. O cliente não é avisado.</p>
          {erro && <p role="alert" className="text-sm font-medium text-destructive">{erro}</p>}
        </div>
      )}
    </div>
  )
}
