'use client'
import { MessageSquareText, SendHorizontal } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { RespostaRapida } from '@atd/db'
import { Textarea } from '@/components/form/textarea'
import { Button } from '@/components/ui/button'
import { chamarAcao, type ActionResult } from '@/lib/action-result'
import { TEXTO_FORA_DA_JANELA } from '@/lib/conversas'
import { respostaSchema, type RespostaForm } from '@/lib/schemas/conversas'

type Enviar = (id: string, input: RespostaForm) => Promise<ActionResult<{ messageId: number; envioAtrasado: boolean }>>
type Estado = { tipo: 'ocioso' } | { tipo: 'enviando' } | { tipo: 'enviado' } | { tipo: 'falhou'; erro: string }

/** Enter envia só com teclado físico e mouse (desktop); no celular, Enter quebra linha e envia pelo botão. */
function ehDesktop() {
  try {
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches
  } catch {
    return false
  }
}

function MenuRespostas(props: { respostas: RespostaRapida[]; onEscolher: (texto: string) => void; desabilitado: boolean }) {
  const [aberto, setAberto] = useState(false)
  const menuId = useId()
  const botao = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!aberto) return
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAberto(false)
        botao.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [aberto])
  return (
    <div className="relative">
      <Button
        ref={botao}
        type="button"
        variant="outline"
        size="icon"
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-controls={aberto ? menuId : undefined}
        aria-label="Respostas rápidas"
        disabled={props.desabilitado}
        onClick={() => setAberto((a) => !a)}
      >
        <MessageSquareText aria-hidden="true" className="size-5" />
      </Button>
      {aberto && (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label="Respostas rápidas"
          className="absolute bottom-full left-0 z-20 mb-2 max-h-72 w-[min(20rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {props.respostas.map((r) => (
            <button
              key={r.id}
              type="button"
              role="menuitem"
              className="flex min-h-11 w-full flex-col items-start rounded-md px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-ring [@media(hover:hover)]:hover:bg-accent"
              onClick={() => {
                props.onEscolher(r.texto)
                setAberto(false)
                botao.current?.focus()
              }}
            >
              <span className="text-sm font-medium">{r.titulo}</span>
              <span className="line-clamp-1 text-xs text-muted-foreground">{r.texto}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function Compositor(props: {
  conversationId: string
  foraDaJanela: boolean
  respostasRapidas: RespostaRapida[]
  enviar: Enviar
}) {
  const [texto, setTexto] = useState('')
  const [erroCampo, setErroCampo] = useState<string | null>(null)
  const [estado, setEstado] = useState<Estado>({ tipo: 'ocioso' })
  const andando = useRef(false)
  const campo = useRef<HTMLTextAreaElement>(null)
  const campoId = useId()
  const erroId = useId()
  const bloqueado = props.foraDaJanela

  const enviar = async () => {
    if (andando.current || bloqueado) return
    const v = respostaSchema.safeParse({ texto })
    if (!v.success) {
      setErroCampo(v.error.issues[0]?.message ?? 'Resposta inválida.')
      return
    }
    setErroCampo(null)
    andando.current = true
    setEstado({ tipo: 'enviando' })
    try {
      const r = await chamarAcao(() => props.enviar(props.conversationId, { texto }))
      if (r.ok) {
        setTexto('')
        setEstado({ tipo: 'enviado' })
        if (r.data?.envioAtrasado) toast.warning('Resposta salva. O envio pelo WhatsApp pode atrasar um pouco.')
      } else {
        setEstado({ tipo: 'falhou', erro: r.fieldErrors?.texto ?? r.formError ?? 'Não foi possível enviar. Tente de novo.' })
      }
    } finally {
      andando.current = false
    }
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        void enviar()
      }}
    >
      <label htmlFor={campoId} className="sr-only">Resposta</label>
      {bloqueado && <p className="rounded-md border border-border bg-secondary/40 p-3 text-sm text-muted-foreground">{TEXTO_FORA_DA_JANELA}</p>}
      <div className="flex items-end gap-2">
        {props.respostasRapidas.length > 0 && (
          <MenuRespostas
            respostas={props.respostasRapidas}
            desabilitado={bloqueado}
            onEscolher={(t) => {
              setTexto(t)
              campo.current?.focus()
            }}
          />
        )}
        <Textarea
          ref={campo}
          id={campoId}
          rows={2}
          className="min-h-11 flex-1 resize-none"
          placeholder={bloqueado ? '' : 'Escreva a resposta'}
          value={texto}
          disabled={bloqueado}
          aria-invalid={erroCampo ? true : undefined}
          aria-describedby={erroCampo ? erroId : undefined}
          onChange={(e) => {
            setTexto(e.target.value)
            if (estado.tipo === 'enviado') setEstado({ tipo: 'ocioso' })
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && ehDesktop()) {
              e.preventDefault()
              void enviar()
            }
          }}
        />
        <Button
          type="submit"
          size="icon"
          aria-label="Enviar"
          disabled={bloqueado || estado.tipo === 'enviando'}
          aria-busy={estado.tipo === 'enviando' || undefined}
        >
          <SendHorizontal aria-hidden="true" className="size-5" />
        </Button>
      </div>
      {erroCampo && <p id={erroId} className="text-sm text-destructive">{erroCampo}</p>}
      <div aria-live="polite">
        {estado.tipo === 'enviando' && <p role="status" className="text-sm text-muted-foreground">Enviando…</p>}
        {estado.tipo === 'enviado' && <p role="status" className="text-sm text-muted-foreground">Enviado</p>}
      </div>
      {estado.tipo === 'falhou' && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive p-3 text-sm text-destructive">
          <span>{estado.erro}</span>
          <Button type="button" variant="outline" onClick={() => void enviar()}>Tentar de novo</Button>
        </div>
      )}
    </form>
  )
}
