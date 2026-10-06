'use client'
import { Bot, CircleCheck, Hand } from 'lucide-react'
import Link from 'next/link'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { dentroDaJanela, podeTransicionar } from '@atd/core/conversa'
import type { ConversationState, HandoffMotivo, RespostaRapida } from '@atd/db'
import { Confirmar } from '@/components/painel/confirmar'
import { Button } from '@/components/ui/button'
import { chamarAcao, type ActionResult } from '@/lib/action-result'
import { ROTULO_MOTIVO } from '@/lib/conversas'
import type { AssumirForm, RespostaForm } from '@/lib/schemas/conversas'
import { Bolha, type MensagemTelaInbox } from './bolha'
import { Compositor } from './compositor'
import { SeloEstado, SeloSimulacao } from './lista'

export type ConversaTela = {
  id: string
  nome: string | null
  unidade: string | null
  estado: ConversationState
  atendente: string | null
  atendenteId: string | null
  janelaAte: Date | null
  simulada: boolean
  handoffMotivo: HandoffMotivo | null
}

export type AcoesConversa = {
  assumir: (id: string, input: AssumirForm) => Promise<ActionResult<null>>
  responder: (id: string, input: RespostaForm) => Promise<ActionResult<{ messageId: number; envioAtrasado: boolean }>>
  reenviar: (messageId: number) => Promise<ActionResult<{ envioAtrasado: boolean }>>
  devolver: (id: string) => Promise<ActionResult<null>>
  encerrar: (id: string) => Promise<ActionResult<null>>
  mostrarTelefone: (id: string) => Promise<ActionResult<{ telefone: string }>>
}

const ERRO = 'Não foi possível concluir agora. Tente de novo.'
const erroDe = (r: ActionResult<unknown>) => (r.ok ? ERRO : (r.formError ?? ERRO))

function Telefone(props: { id: string; mostrar: AcoesConversa['mostrarTelefone'] }) {
  // o número vive só neste estado: nunca vai nas props da página
  const [telefone, setTelefone] = useState<string | null>(null)
  const [buscando, setBuscando] = useState(false)
  if (telefone !== null) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-foreground">{telefone}</span>
        <Button type="button" variant="ghost" onClick={() => setTelefone(null)}>Ocultar telefone</Button>
      </div>
    )
  }
  return (
    <Button
      type="button"
      variant="ghost"
      className="self-start"
      disabled={buscando}
      aria-busy={buscando || undefined}
      onClick={async () => {
        setBuscando(true)
        try {
          const r = await chamarAcao(() => props.mostrar(props.id))
          if (r.ok && r.data) setTelefone(r.data.telefone)
          else toast.error(erroDe(r))
        } finally {
          setBuscando(false)
        }
      }}
    >
      Mostrar telefone
    </Button>
  )
}

export function Conversa(props: {
  conversa: ConversaTela
  mensagens: MensagemTelaInbox[]
  meuId: string
  papel: 'dono' | 'gerente' | 'atendente'
  timezone: string
  agora?: Date
  respostasRapidas: RespostaRapida[]
  /** Link para a página de mensagens anteriores (null: não há mais). */
  maisAntigas: string | null
  acoes: AcoesConversa
}) {
  const c = props.conversa
  const gestao = props.papel !== 'atendente'
  const comigo = c.estado === 'humano' && c.atendenteId === props.meuId
  // `humano` sem atendente (usuário removido): livre, como na DAL
  const semAtendente = c.estado === 'humano' && c.atendenteId === null
  const comOutro = c.estado === 'humano' && !comigo && !semAtendente
  const podeAssumir = c.estado === 'ia' || c.estado === 'aguardando_humano' || semAtendente
  const podeMudar = !comOutro || gestao
  const [andando, setAndando] = useState(false)
  const [confirmarForcar, setConfirmarForcar] = useState(false)
  const [confirmarEncerrar, setConfirmarEncerrar] = useState(false)
  const [reenviando, setReenviando] = useState<number | null>(null)
  const trava = useRef(false)

  async function rodar<T>(acao: () => Promise<ActionResult<T>>, sucesso: string): Promise<boolean> {
    if (trava.current) return false
    trava.current = true
    setAndando(true)
    try {
      const r = await chamarAcao(acao)
      if (r.ok) toast.success(sucesso)
      else toast.error(erroDe(r))
      return r.ok
    } finally {
      trava.current = false
      setAndando(false)
    }
  }

  const foraDaJanela = !dentroDaJanela(c.janelaAte ? new Date(c.janelaAte) : null, props.agora ?? new Date())

  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Situação da conversa" className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <SeloEstado estado={c.estado} />
          {c.simulada && <SeloSimulacao />}
          <span className="text-sm text-muted-foreground">{c.unidade ?? 'Unidade não definida'}</span>
        </div>
        {c.estado === 'aguardando_humano' && c.handoffMotivo && (
          <p className="text-sm text-muted-foreground">Motivo: {ROTULO_MOTIVO[c.handoffMotivo]}</p>
        )}
        {comigo && <p className="text-sm text-foreground">Você está atendendo esta conversa.</p>}
        {comOutro && <p className="text-sm text-foreground">{c.atendente ?? 'Outra pessoa'} está atendendo esta conversa.</p>}
        <div className="flex flex-wrap gap-2">
          {podeAssumir && (
            <Button type="button" disabled={andando} onClick={() => void rodar(() => props.acoes.assumir(c.id, { forcar: false }), 'Conversa assumida. Agora é com você.')}>
              <Hand aria-hidden="true" className="size-4" /> Assumir
            </Button>
          )}
          {comOutro && gestao && (
            <Button type="button" variant="outline" disabled={andando} onClick={() => setConfirmarForcar(true)}>
              <Hand aria-hidden="true" className="size-4" /> Assumir mesmo assim
            </Button>
          )}
          {podeTransicionar(c.estado, 'ia') && podeMudar && (
            <Button type="button" variant="secondary" disabled={andando} onClick={() => void rodar(() => props.acoes.devolver(c.id), 'Conversa devolvida à IA.')}>
              <Bot aria-hidden="true" className="size-4" /> Devolver à IA
            </Button>
          )}
          {podeTransicionar(c.estado, 'encerrada') && podeMudar && (
            <Button type="button" variant="outline" disabled={andando} onClick={() => setConfirmarEncerrar(true)}>
              <CircleCheck aria-hidden="true" className="size-4" /> Encerrar
            </Button>
          )}
        </div>
        {!c.simulada && <Telefone id={c.id} mostrar={props.acoes.mostrarTelefone} />}
      </section>

      <section aria-label="Mensagens" className="flex flex-col gap-2">
        {props.maisAntigas && (
          <Link href={props.maisAntigas} className="inline-flex min-h-11 items-center self-center text-sm font-medium text-link underline-offset-4 [@media(hover:hover)]:hover:underline">
            Carregar anteriores
          </Link>
        )}
        {props.mensagens.length === 0 && <p className="text-center text-sm text-muted-foreground">Nenhuma mensagem ainda.</p>}
        {props.mensagens.map((m) => (
          <Bolha
            key={m.id}
            m={m}
            timezone={props.timezone}
            tentando={reenviando === m.id}
            {...(comigo && {
              onTentarDeNovo: async (id: number) => {
                if (reenviando !== null) return
                setReenviando(id)
                try {
                  const r = await chamarAcao(() => props.acoes.reenviar(id))
                  if (!r.ok) toast.error(erroDe(r))
                  else if (r.data?.envioAtrasado) toast.warning('Mensagem na fila. O envio pelo WhatsApp pode atrasar um pouco.')
                } finally {
                  setReenviando(null)
                }
              },
            })}
          />
        ))}
      </section>

      {comigo
        ? (
          <section aria-label="Responder" className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] rounded-lg border border-border bg-background p-3">
            <Compositor conversationId={c.id} foraDaJanela={foraDaJanela} respostasRapidas={props.respostasRapidas} enviar={props.acoes.responder} />
          </section>
        )
        : c.estado !== 'encerrada' && !comOutro && <p className="text-center text-sm text-muted-foreground">Assuma a conversa para responder o cliente.</p>}

      <Confirmar
        aberto={confirmarForcar}
        onAbertoChange={setConfirmarForcar}
        titulo="Assumir esta conversa?"
        descricao={`${c.atendente ?? 'Outra pessoa'} está atendendo. Ao assumir, você passa a responder e ${c.atendente ?? 'essa pessoa'} deixa de poder responder.`}
        rotuloConfirmar="Assumir conversa"
        rotuloAndamento="Assumindo…"
        onConfirmar={async () => {
          if (await rodar(() => props.acoes.assumir(c.id, { forcar: true }), 'Conversa assumida. Agora é com você.')) setConfirmarForcar(false)
        }}
      />
      <Confirmar
        aberto={confirmarEncerrar}
        onAbertoChange={setConfirmarEncerrar}
        titulo="Encerrar a conversa?"
        descricao="A conversa sai da fila. Se o cliente escrever de novo, a IA começa uma conversa nova."
        rotuloConfirmar="Encerrar conversa"
        rotuloAndamento="Encerrando…"
        onConfirmar={async () => {
          if (await rodar(() => props.acoes.encerrar(c.id), 'Conversa encerrada.')) setConfirmarEncerrar(false)
        }}
      />
    </div>
  )
}
