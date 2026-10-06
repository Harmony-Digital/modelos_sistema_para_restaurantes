'use client'
import { BellRing } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { tituloComContador } from '@/lib/conversas'
import { useInbox } from '@/lib/realtime/use-inbox'

const CHAVE_SOM = 'atd-avisos-som'
const CHAVE_NOTIFICACAO = 'atd-avisos-notificacao'
const SOM = '/avisos/nova-conversa.wav'
/** Texto fixo: nunca nome, telefone ou trecho do cliente. */
const TEXTO_NOTIFICACAO = 'Nova conversa aguardando atendente'

// preferência local do aparelho: localStorage pode não existir ou lançar (aba anônima, bloqueio do navegador)
function ler(chave: string): boolean {
  try {
    return window.localStorage.getItem(chave) === '1'
  } catch {
    return false
  }
}
function gravar(chave: string, ligado: boolean) {
  try {
    window.localStorage.setItem(chave, ligado ? '1' : '0')
  } catch {
    /* sem preferência salva: segue a sessão */
  }
}
function permissao(): NotificationPermission | 'indisponivel' {
  try {
    return typeof Notification === 'undefined' ? 'indisponivel' : Notification.permission
  } catch {
    return 'indisponivel'
  }
}

function avisar() {
  if (ler(CHAVE_SOM)) {
    try {
      void new Audio(SOM).play().catch(() => undefined)
    } catch {
      /* navegador sem áudio */
    }
  }
  const emFoco = typeof document.hasFocus === 'function' ? document.hasFocus() : !document.hidden
  if (!emFoco && ler(CHAVE_NOTIFICACAO) && permissao() === 'granted') {
    try {
      new Notification(TEXTO_NOTIFICACAO, { tag: 'atd-aguardando' })
    } catch {
      /* alguns navegadores móveis só notificam por service worker */
    }
  }
}

/**
 * Fica no layout do painel: assina a inbox no Realtime (a recarga traz o novo `aguardando`), mantém o contador no
 * título da aba e avisa (som/notificação) só quando o contador sobe.
 */
export function Avisos(props: { aguardando: number; topicos: string[] }) {
  useInbox(props.topicos)
  const path = usePathname()
  const anterior = useRef(props.aguardando)
  useEffect(() => {
    if (props.aguardando > anterior.current) avisar()
    anterior.current = props.aguardando
  }, [props.aguardando])
  // a navegação troca o <title> da página: reaplica o contador
  useEffect(() => {
    document.title = tituloComContador(document.title, props.aguardando)
  }, [props.aguardando, path])
  return null
}

/** Botão "Ativar avisos" e o liga/desliga do som (na tela de Conversas). */
export function ControlesAvisos() {
  const [notificacao, setNotificacao] = useState(false)
  const [som, setSom] = useState(false)
  const [mensagem, setMensagem] = useState<string | null>(null)
  const somId = useId()
  useEffect(() => {
    // depois da hidratação: o servidor não conhece as preferências do aparelho
    setNotificacao(ler(CHAVE_NOTIFICACAO) && permissao() === 'granted')
    setSom(ler(CHAVE_SOM))
  }, [])

  const ativar = async () => {
    if (permissao() === 'indisponivel') {
      setMensagem('Este navegador não mostra avisos. Deixe o som ligado para ser avisado.')
      return
    }
    let p: NotificationPermission
    try {
      p = await Notification.requestPermission()
    } catch {
      p = 'denied'
    }
    if (p === 'granted') {
      gravar(CHAVE_NOTIFICACAO, true)
      setNotificacao(true)
      setMensagem('Avisos do navegador ativados.')
    } else {
      setMensagem('O navegador bloqueou os avisos. Libere as notificações deste site nas configurações do navegador.')
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {!notificacao && (
        <Button type="button" variant="outline" onClick={() => void ativar()}>
          <BellRing aria-hidden="true" className="size-4" /> Ativar avisos
        </Button>
      )}
      <div className="flex min-h-11 items-center gap-2">
        <Switch
          id={somId}
          checked={som}
          onCheckedChange={(v) => {
            setSom(v)
            gravar(CHAVE_SOM, v)
          }}
        />
        <label htmlFor={somId} className="text-sm text-foreground">Som de aviso</label>
      </div>
      <p aria-live="polite" className="basis-full text-sm text-muted-foreground empty:hidden">{mensagem}</p>
    </div>
  )
}
