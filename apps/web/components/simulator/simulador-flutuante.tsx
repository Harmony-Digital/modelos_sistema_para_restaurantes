'use client'
import { Minus, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { MIDIA_XL, useMidia } from '@/lib/use-midia'
import { cn } from '@/lib/utils'
import { WA } from './colors'
import { PhoneFrame } from './phone-frame'
import type { SimMessage } from './types'
import { WhatsAppChat } from './whatsapp-chat'
import { WhatsAppIcon } from './whatsapp-icon'

const BOTAO = 'flex size-11 items-center justify-center rounded-full text-muted-foreground [@media(hover:hover)]:hover:bg-accent [@media(hover:hover)]:hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

/**
 * Simulador flutuante (≥ lg): "celular" ancorado no canto direito, sobre a tela, sem bloquear o painel (não modal).
 * Fica entre a barra superior (top-16) e a borda de baixo; a altura do celular cabe no que sobra e a área vazia
 * ao redor deixa o clique passar (pointer-events-none; só a pílula e o celular capturam).
 * ≥ xl: controles ao lado do celular. < xl (ex.: 1024 px com o menu aberto): compacto — celular mais estreito,
 * controles recolhidos atrás de um botão (abrem sobre o celular) e clicar fora minimiza, para não esconder o
 * compositor de Conversas nem as ações da tela.
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
  const { minimizado, onMinimizado } = props
  const largo = useMidia(MIDIA_XL)
  const [controlesAbertos, setControlesAbertos] = useState(false)
  const controlesId = useId()
  // minimizado por clique fora: o foco fica onde a pessoa clicou
  const focarRestaurar = useRef(true)
  // foco segue o estado: aberto ⇒ campo de mensagem; minimizado ⇒ botão de restaurar
  useEffect(() => {
    if (minimizado) {
      if (focarRestaurar.current) restaurar.current?.focus()
      focarRestaurar.current = true
    } else painel.current?.querySelector<HTMLTextAreaElement>('textarea[aria-label="Mensagem"]')?.focus()
  }, [minimizado])
  // < xl: clicar fora do painel minimiza (o painel não cobre a tela de forma permanente)
  useEffect(() => {
    if (minimizado || largo !== false) return
    const fora = (e: PointerEvent) => {
      if (e.target instanceof Node && painel.current?.contains(e.target)) return
      focarRestaurar.current = false
      onMinimizado(true)
    }
    document.addEventListener('pointerdown', fora, true)
    return () => document.removeEventListener('pointerdown', fora, true)
  }, [minimizado, largo, onMinimizado])

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
        className="pointer-events-none fixed bottom-4 right-4 top-16 z-40 flex flex-col items-end justify-end gap-2"
      >
        <div className="pointer-events-auto flex shrink-0 items-center gap-1 rounded-full border border-border bg-background py-0.5 pl-4 pr-0.5 text-sm shadow-lg">
          <span className="mr-2 font-medium text-foreground">Simulador</span>
          <button
            type="button"
            aria-label="Controles da simulação"
            title="Novo cliente, data e hora, detalhes"
            aria-expanded={controlesAbertos}
            aria-controls={controlesId}
            onClick={() => setControlesAbertos((v) => !v)}
            className={cn(BOTAO, 'xl:hidden')}
          >
            <SlidersHorizontal aria-hidden="true" className="size-5" />
          </button>
          <button type="button" aria-label="Minimizar simulador" title="Minimizar (Shift+S)" onClick={() => props.onMinimizado(true)} className={BOTAO}>
            <Minus aria-hidden="true" className="size-5" />
          </button>
          <button type="button" aria-label="Fechar simulador" title="Fechar" onClick={props.onFechar} className={BOTAO}>
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>
        <p className="sr-only">Converse como se fosse um cliente. As respostas passam pela IA de verdade e nunca são enviadas pelo WhatsApp.</p>
        <div className="pointer-events-auto relative shrink-0">
          {/* ≥ xl: à esquerda do celular; < xl: recolhidos, abrem sobre o topo do celular */}
          <div
            id={controlesId}
            data-controles=""
            className={cn(
              'absolute left-2 right-2 top-2 z-30 max-h-[calc(100%-1rem)] overflow-y-auto rounded-xl',
              controlesAbertos ? 'block' : 'hidden',
              'xl:left-auto xl:right-full xl:top-0 xl:mr-4 xl:block xl:max-h-full xl:w-64',
            )}
          >
            {props.controles}
          </div>
          {/* altura: 100dvh − top-16 (4rem) − pílula (~3,1rem) − gap (0,5rem) − bottom-4 (1rem) ≈ 9rem */}
          <PhoneFrame data-celular="" className="md:h-[min(760px,calc(100dvh-9rem))] md:w-[320px] xl:w-[360px] md:rounded-[44px] md:border-[10px]">
            <WhatsAppChat restaurante={props.restaurante} mensagens={props.mensagens} digitando={props.digitando} onEnviar={props.onEnviar} onEscolher={props.onEscolher} />
          </PhoneFrame>
        </div>
      </section>
      {minimizado && (
        // coluna estreita (só ícones), na mesma faixa do botão flutuante: não cobre o Enviar do compositor (lg:mr-14)
        <div role="group" aria-label="Simulador minimizado" className="fixed bottom-6 right-6 z-40 flex flex-col items-center gap-1 rounded-full border border-border bg-background p-1 shadow-xl">
          <button
            ref={restaurar}
            type="button"
            aria-label="Restaurar simulador"
            title="Restaurar (Shift+S)"
            onClick={() => props.onMinimizado(false)}
            className="flex min-h-11 items-center gap-2 rounded-full p-1 text-sm font-medium text-foreground [@media(hover:hover)]:hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-full" style={{ background: WA.verde, color: WA.fundo }}>
              <WhatsAppIcon className="size-5" />
            </span>
            <span className="sr-only">Simulador</span>
          </button>
          <button type="button" aria-label="Fechar simulador" title="Fechar" onClick={props.onFechar} className={BOTAO}>
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>
      )}
    </>
  )
}
