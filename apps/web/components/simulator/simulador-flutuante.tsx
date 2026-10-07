'use client'
import { Minus, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { WA } from './colors'
import { PhoneFrame } from './phone-frame'
import type { SimMessage } from './types'
import { WhatsAppChat } from './whatsapp-chat'
import { WhatsAppIcon } from './whatsapp-icon'

const BOTAO = 'flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

/**
 * Simulador flutuante (≥ lg): "celular" ancorado no canto direito, sobre a tela, sem bloquear o painel (não modal).
 * Minimizado vira uma pílula no canto e o histórico/rascunho continuam montados. Esc minimiza.
 */
export default function SimuladorFlutuante(props: {
  minimizado: boolean
  onMinimizado: (v: boolean) => void
  onFechar: () => void
  restaurante: string
  mensagens: SimMessage[]
  digitando: boolean
  onEnviar: (texto: string) => void
  onEscolher: (mensagemId: string, itemId: string, titulo: string) => void
  controles: React.ReactNode
}) {
  const painel = useRef<HTMLElement>(null)
  const restaurar = useRef<HTMLButtonElement>(null)
  const { minimizado } = props
  // foco segue o estado: aberto ⇒ campo de mensagem; minimizado ⇒ botão de restaurar
  useEffect(() => {
    if (minimizado) restaurar.current?.focus()
    else painel.current?.querySelector<HTMLTextAreaElement>('textarea[aria-label="Mensagem"]')?.focus()
  }, [minimizado])

  return (
    <>
      <section
        ref={painel}
        role="dialog"
        aria-modal="false"
        aria-label="Simulador de WhatsApp"
        data-simulador-flutuante=""
        hidden={minimizado}
        onKeyDown={(e) => {
          if (e.key !== 'Escape' || e.defaultPrevented) return
          e.preventDefault()
          props.onMinimizado(true)
        }}
        className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2"
      >
        <div className="flex items-center gap-1 rounded-full border border-border bg-background py-0.5 pl-4 pr-0.5 text-sm shadow-lg">
          <span className="mr-2 font-medium text-foreground">Simulador</span>
          <button type="button" aria-label="Minimizar simulador" title="Minimizar (Shift+S)" onClick={() => props.onMinimizado(true)} className={BOTAO}>
            <Minus aria-hidden="true" className="size-5" />
          </button>
          <button type="button" aria-label="Fechar simulador" title="Fechar" onClick={props.onFechar} className={BOTAO}>
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>
        <p className="sr-only">Converse como se fosse um cliente. As respostas passam pela IA de verdade e nunca são enviadas pelo WhatsApp.</p>
        {/* os controles ficam à esquerda do celular (md:absolute md:right-full) */}
        <div className="relative">
          {props.controles}
          <PhoneFrame className="md:h-[min(760px,calc(100dvh-5.5rem))] md:w-[360px] md:rounded-[44px] md:border-[10px]">
            <WhatsAppChat restaurante={props.restaurante} mensagens={props.mensagens} digitando={props.digitando} onEnviar={props.onEnviar} onEscolher={props.onEscolher} />
          </PhoneFrame>
        </div>
      </section>
      {minimizado && (
        <div role="group" aria-label="Simulador minimizado" className="fixed bottom-6 right-6 z-40 flex items-center gap-1 rounded-full border border-border bg-background p-1 shadow-xl">
          <button
            ref={restaurar}
            type="button"
            aria-label="Restaurar simulador"
            title="Restaurar (Shift+S)"
            onClick={() => props.onMinimizado(false)}
            className="flex min-h-11 items-center gap-2 rounded-full pl-1 pr-4 text-sm font-medium text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-full" style={{ background: WA.verde, color: WA.fundo }}>
              <WhatsAppIcon className="size-5" />
            </span>
            Simulador
          </button>
          <button type="button" aria-label="Fechar simulador" title="Fechar" onClick={props.onFechar} className={BOTAO}>
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>
      )}
    </>
  )
}
