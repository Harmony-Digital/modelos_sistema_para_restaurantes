'use client'
import dynamic from 'next/dynamic'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { EVENTO_ABRIR_SIMULADOR } from './abrir'
import { SimuladorControles } from './controles'
import { useSimulador, type AcoesSimulador } from './use-simulador'
import { WA } from './colors'
import { WhatsAppIcon } from './whatsapp-icon'

// o conteúdo do simulador só é baixado na primeira abertura; o botão flutuante é estático
const SimulatorDialog = dynamic(() => import('./simulator-dialog'), {
  ssr: false,
  loading: () => (
    <div role="status" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 text-sm text-white">
      Carregando…
    </div>
  ),
})

export function SimulatorLauncher({ restaurante, timezone, acoes }: { restaurante: string; timezone: string; acoes: AcoesSimulador }) {
  const [aberto, setAberto] = useState(false)
  const [jaAbriu, setJaAbriu] = useState(false)
  // navegar (ex.: link "Gastos e limites" do aviso) fecha o simulador: a tela nova não fica escondida atrás dele
  const caminho = usePathname()
  const [caminhoVisto, setCaminhoVisto] = useState(caminho)
  if (caminho !== caminhoVisto) {
    setCaminhoVisto(caminho)
    setAberto(false)
  }
  const fab = useRef<HTMLButtonElement>(null)
  // o item "Simulador" do menu lateral / folha Mais abre o mesmo simulador
  useEffect(() => {
    const abrir = () => { setJaAbriu(true); setAberto(true) }
    window.addEventListener(EVENTO_ABRIR_SIMULADOR, abrir)
    return () => window.removeEventListener(EVENTO_ABRIR_SIMULADOR, abrir)
  }, [])
  const sim = useSimulador(acoes, aberto, timezone)
  return (
    <>
      <button
        ref={fab}
        type="button"
        aria-label="Abrir simulador de WhatsApp"
        onClick={() => { setJaAbriu(true); setAberto(true) }}
        className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 lg:bottom-6 lg:right-6 z-50 flex size-14 items-center justify-center rounded-full shadow-xl transition-transform duration-150 ease-out hover:scale-105 motion-reduce:transition-none motion-reduce:hover:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        style={{ background: WA.verde, color: WA.fundo }}
      >
        <WhatsAppIcon className="size-7" />
      </button>
      {jaAbriu && (
        <SimulatorDialog
          aberto={aberto}
          onAbertoChange={setAberto}
          restaurante={restaurante}
          mensagens={sim.mensagens}
          digitando={sim.digitando}
          onEnviar={sim.enviar}
          onFechado={() => fab.current?.focus()}
          onEscolher={sim.escolher}
          controles={
            <SimuladorControles
              timezone={timezone}
              offset={sim.offset}
              relogio={sim.relogio}
              erro={sim.erro}
              detalhes={sim.detalhes}
              onNovoCliente={() => void sim.novoCliente()}
              onRelogio={sim.mudarRelogio}
              onDetalhes={() => void sim.verDetalhes()}
            />
          }
        />
      )}
    </>
  )
}
