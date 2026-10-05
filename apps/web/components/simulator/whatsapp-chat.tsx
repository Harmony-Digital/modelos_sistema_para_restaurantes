'use client'
import { ArrowLeft, MoreVertical, Phone, SendHorizontal, Video } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Bubble, WA } from './bubbles'
import type { SimMessage } from './types'

export { WA }

export function WhatsAppChat(props: {
  restaurante: string
  mensagens: SimMessage[]
  digitando: boolean
  onEnviar: (texto: string) => void
  onEscolher: (mensagemId: string, itemId: string, titulo: string) => void
}) {
  const [texto, setTexto] = useState('')
  const fim = useRef<HTMLDivElement>(null)
  useEffect(() => { fim.current?.scrollIntoView?.({ block: 'end' }) }, [props.mensagens.length, props.digitando])

  const enviar = () => {
    const t = texto.trim()
    if (!t) return
    props.onEnviar(t)
    setTexto('')
  }

  return (
    <div className="flex h-full flex-col" style={{ background: WA.fundo, color: WA.texto }}>
      <div className="flex h-14 shrink-0 items-center gap-3 px-2" style={{ background: WA.barra }}>
        <ArrowLeft aria-hidden="true" className="size-5" />
        <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-full text-sm font-semibold" style={{ background: '#6B7C85' }}>
          {props.restaurante.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-medium leading-tight" style={{ color: WA.texto }}>{props.restaurante}</h2>
          <p className="text-xs" style={{ color: WA.meta }}>{props.digitando ? 'digitando…' : 'online'}</p>
        </div>
        <Video aria-hidden="true" className="size-5" /><Phone aria-hidden="true" className="ml-3 size-5" /><MoreVertical aria-hidden="true" className="ml-2 size-5" />
      </div>

      <div
        role="log"
        aria-live="polite"
        aria-label="Conversa"
        className="flex-1 overflow-y-auto px-3 py-2"
        style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.035) 1px, transparent 1px)', backgroundSize: '18px 18px' }}
      >
        <p className="mx-auto mb-2 w-fit rounded-md px-2 py-1 text-xs" style={{ background: '#182229', color: WA.meta }}>Hoje</p>
        {props.mensagens.map((m) => <Bubble key={m.id} m={m} onEscolher={props.onEscolher} />)}
        <div ref={fim} />
      </div>

      <form
        className="flex shrink-0 items-end gap-2 px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
        onSubmit={(e) => { e.preventDefault(); enviar() }}
      >
        <input
          aria-label="Mensagem"
          placeholder="Mensagem"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          autoFocus
          className="h-11 flex-1 rounded-full px-4 text-[15px] outline-none placeholder:opacity-80"
          style={{ background: WA.barra, color: WA.texto }}
        />
        <button
          type="submit"
          aria-label="Enviar"
          disabled={!texto.trim()}
          className="flex size-11 items-center justify-center rounded-full disabled:opacity-60"
          style={{ background: WA.verde, color: WA.fundo }}
        >
          <SendHorizontal aria-hidden="true" className="size-5" />
        </button>
      </form>
    </div>
  )
}
