'use client'
import dynamic from 'next/dynamic'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { ehCampoDeTexto, ignorarAtalho } from '@/lib/atalhos'
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

const SimuladorFlutuante = dynamic(() => import('./simulador-flutuante'), {
  ssr: false,
  loading: () => <div role="status" className="fixed bottom-6 right-6 z-40 rounded-md bg-background px-3 py-2 text-sm shadow-xl">Carregando…</div>,
})

/** `lg` (≥ 1024 px): simulador flutuante; abaixo, a folha de tela cheia. false até saber (como no SSR). */
function useLargo(): boolean {
  const [largo, setLargo] = useState(false)
  useEffect(() => {
    const m = window.matchMedia('(min-width: 1024px)')
    const atualizar = () => setLargo(m.matches)
    atualizar()
    m.addEventListener('change', atualizar)
    return () => m.removeEventListener('change', atualizar)
  }, [])
  return largo
}

/** Shift+S (sem Ctrl/Cmd/Alt), fora de campo de texto e de diálogo — o próprio simulador flutuante não conta como diálogo. */
function ehAtalhoSimulador(e: KeyboardEvent): boolean {
  if (!e.shiftKey || e.key.toLowerCase() !== 's') return false
  if (!ignorarAtalho(e)) return true
  const noFlutuante = e.target instanceof Element && e.target.closest('[data-simulador-flutuante]') !== null
  return noFlutuante && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat && !e.defaultPrevented && !ehCampoDeTexto(e.target)
}

export function SimulatorLauncher({ restaurante, timezone, acoes }: { restaurante: string; timezone: string; acoes: AcoesSimulador }) {
  const [aberto, setAberto] = useState(false)
  const [minimizado, setMinimizado] = useState(false)
  const [jaAbriu, setJaAbriu] = useState(false)
  const largo = useLargo()
  // < lg: navegar (ex.: link "Gastos e limites" do aviso) fecha a folha, que cobre a tela nova.
  // ≥ lg: o flutuante fica no canto e acompanha a navegação (montado no layout do painel).
  const caminho = usePathname()
  const [caminhoVisto, setCaminhoVisto] = useState(caminho)
  if (caminho !== caminhoVisto) {
    setCaminhoVisto(caminho)
    if (!largo) setAberto(false)
  }
  const fab = useRef<HTMLButtonElement>(null)
  const abrir = () => { setJaAbriu(true); setAberto(true); setMinimizado(false) }
  const fechar = () => { setAberto(false); setMinimizado(false); requestAnimationFrame(() => fab.current?.focus()) }
  // o item "Simulador" do menu lateral / folha Mais / busca rápida abre (ou restaura) o mesmo simulador
  useEffect(() => {
    window.addEventListener(EVENTO_ABRIR_SIMULADOR, abrir)
    return () => window.removeEventListener(EVENTO_ABRIR_SIMULADOR, abrir)
  }, [])
  // Shift+S: fechado ou minimizado ⇒ abre; aberto no flutuante ⇒ minimiza
  const estado = useRef({ aberto, minimizado, largo })
  estado.current = { aberto, minimizado, largo }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!ehAtalhoSimulador(e)) return
      e.preventDefault()
      const { aberto: a, minimizado: m, largo: l } = estado.current
      if (a && !m && l) setMinimizado(true)
      else abrir()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // minimizado não consulta o servidor (como a aba escondida); ao restaurar, retoma do cursor
  const sim = useSimulador(acoes, aberto && !minimizado, timezone)
  const controles = (
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
  )
  const flutuante = largo && aberto
  return (
    <>
      {!flutuante && (
        <button
          ref={fab}
          type="button"
          aria-label="Abrir simulador de WhatsApp"
          aria-keyshortcuts="Shift+S"
          onClick={abrir}
          className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 lg:bottom-6 lg:right-6 z-50 flex size-14 items-center justify-center rounded-full shadow-xl transition-transform duration-150 ease-out hover:scale-105 motion-reduce:transition-none motion-reduce:hover:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          style={{ background: WA.verde, color: WA.fundo }}
        >
          <WhatsAppIcon className="size-7" />
        </button>
      )}
      {flutuante && (
        <SimuladorFlutuante
          minimizado={minimizado}
          onMinimizado={setMinimizado}
          onFechar={fechar}
          restaurante={restaurante}
          mensagens={sim.mensagens}
          digitando={sim.digitando}
          onEnviar={sim.enviar}
          onEscolher={sim.escolher}
          controles={controles}
        />
      )}
      {jaAbriu && !largo && (
        <SimulatorDialog
          aberto={aberto && !minimizado}
          onAbertoChange={(v) => { setAberto(v); setMinimizado(false) }}
          restaurante={restaurante}
          mensagens={sim.mensagens}
          digitando={sim.digitando}
          onEnviar={sim.enviar}
          onFechado={() => fab.current?.focus()}
          onEscolher={sim.escolher}
          controles={controles}
        />
      )}
    </>
  )
}
