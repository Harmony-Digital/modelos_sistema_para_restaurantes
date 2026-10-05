'use client'
import { X } from 'lucide-react'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { PhoneFrame } from './phone-frame'
import type { SimMessage } from './types'
import { WhatsAppChat } from './whatsapp-chat'

export default function SimulatorDialog(props: {
  aberto: boolean
  onAbertoChange: (aberto: boolean) => void
  restaurante: string
  mensagens: SimMessage[]
  digitando: boolean
  onEnviar: (texto: string) => void
  /** devolve o foco ao botão flutuante ao fechar */
  onFechado: () => void
  onEscolher: (mensagemId: string, itemId: string, titulo: string) => void
}) {
  return (
    <Dialog open={props.aberto} onOpenChange={props.onAbertoChange}>
      <DialogContent
        showCloseButton={false}
        className="h-dvh max-h-dvh w-full max-w-none gap-0 rounded-none border-0 bg-transparent p-0 shadow-none motion-reduce:animate-none sm:max-w-none md:h-auto md:w-[393px] md:max-w-fit"
        onCloseAutoFocus={(e) => { e.preventDefault(); props.onFechado() }}
        onOpenAutoFocus={(e) => {
          // foco direto no campo de mensagem (não no primeiro link/botão do histórico)
          e.preventDefault()
          ;(e.currentTarget as HTMLElement | null)?.querySelector<HTMLTextAreaElement>('textarea[aria-label="Mensagem"]')?.focus()
        }}
      >
        <DialogTitle className="sr-only">Simulador de WhatsApp</DialogTitle>
        <DialogDescription className="sr-only">Converse como se fosse um cliente. Nenhuma mensagem é enviada pelo WhatsApp de verdade.</DialogDescription>
        <PhoneFrame>
          <WhatsAppChat restaurante={props.restaurante} mensagens={props.mensagens} digitando={props.digitando} onEnviar={props.onEnviar} onEscolher={props.onEscolher} />
        </PhoneFrame>
        {/* fora da moldura no desktop; no topo da tela cheia no celular */}
        <DialogClose
          aria-label="Fechar"
          className="absolute right-2 z-30 flex size-11 items-center justify-center rounded-full bg-black/40 text-white outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:-right-14 md:top-0 top-[calc(env(safe-area-inset-top)+0.375rem)] md:bg-white/10"
        >
          <X aria-hidden="true" className="size-5" />
        </DialogClose>
      </DialogContent>
    </Dialog>
  )
}
