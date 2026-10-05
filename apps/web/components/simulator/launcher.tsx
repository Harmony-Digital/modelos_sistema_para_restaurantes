'use client'
import { X } from 'lucide-react'
import { useState } from 'react'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { PhoneFrame } from './phone-frame'
import { useLocalSimulator } from './use-local-simulator'
import { WhatsAppChat, WA } from './whatsapp-chat'
import { WhatsAppIcon } from './whatsapp-icon'

export function SimulatorLauncher({ restaurante }: { restaurante: string }) {
  const [aberto, setAberto] = useState(false)
  const sim = useLocalSimulator()
  return (
    <>
      <button
        type="button"
        aria-label="Abrir simulador de WhatsApp"
        onClick={() => setAberto(true)}
        className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-50 flex size-14 items-center justify-center rounded-full shadow-xl transition-transform duration-150 ease-out hover:scale-105 motion-reduce:transition-none motion-reduce:hover:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        style={{ background: WA.verde, color: WA.fundo }}
      >
        <WhatsAppIcon className="size-7" />
      </button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent
          showCloseButton={false}
          className="h-dvh max-h-dvh w-full max-w-none gap-0 rounded-none border-0 bg-transparent p-0 shadow-none motion-reduce:animate-none sm:max-w-none md:h-auto md:w-auto md:max-w-fit"
          onOpenAutoFocus={(e) => {
            // foco direto no campo de mensagem (não no primeiro link/botão do histórico)
            e.preventDefault()
            ;(e.currentTarget as HTMLElement | null)?.querySelector<HTMLInputElement>('input[aria-label="Mensagem"]')?.focus()
          }}
        >
          <DialogTitle className="sr-only">Simulador de WhatsApp</DialogTitle>
          <DialogDescription className="sr-only">Converse como se fosse um cliente. Nenhuma mensagem é enviada pelo WhatsApp de verdade.</DialogDescription>
          <PhoneFrame>
            <WhatsAppChat restaurante={restaurante} mensagens={sim.mensagens} digitando={sim.digitando} onEnviar={sim.enviar} onEscolher={sim.escolher} />
          </PhoneFrame>
          {/* fora da moldura no desktop; no topo da tela cheia no celular */}
          <DialogClose
            aria-label="Fechar"
            className="absolute right-2 top-1.5 z-30 flex size-11 items-center justify-center rounded-full bg-black/40 text-white outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:-right-14 md:top-0 md:bg-white/10"
          >
            <X aria-hidden="true" className="size-5" />
          </DialogClose>
        </DialogContent>
      </Dialog>
    </>
  )
}
