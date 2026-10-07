'use client'
import { BookOpen, MessagesSquare, Search, Store, UtensilsCrossed, type LucideIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { abrirSimulador } from '@/components/simulator/abrir'
import { SeloSimulacao } from '@/components/painel/selo-simulacao'
import type { StaffRole } from '@/lib/access'
import type { ActionResult } from '@/lib/action-result'
import { ehCampoDeTexto } from '@/lib/atalhos'
import { hrefDoResultado, MIN_TERMO_BUSCA, telasDaBusca, type ResultadoBusca } from '@/lib/busca-rapida'
import type { ItemNav } from '@/lib/navegacao'
import { cn } from '@/lib/utils'
import { EVENTO_ABRIR_BUSCA } from './abrir-busca'

export { abrirBusca } from './abrir-busca'

const ESPERA_MS = 200
const GRUPOS: { tipo: ResultadoBusca['tipo']; rotulo: string; icone: LucideIcon }[] = [
  { tipo: 'unidade', rotulo: 'Unidades', icone: Store },
  { tipo: 'item', rotulo: 'Cardápio', icone: UtensilsCrossed },
  { tipo: 'informacao', rotulo: 'Informações', icone: BookOpen },
  { tipo: 'conversa', rotulo: 'Conversas', icone: MessagesSquare },
]

type Opcao = { chave: string; tela?: ItemNav; resultado?: ResultadoBusca }
type Busca = { termo: string; resultados: ResultadoBusca[]; erro: boolean }

/** Ctrl/Cmd+K fora de campo de texto (no campo a tecla é dele) e sem outras teclas. */
function ehAtalhoBusca(e: KeyboardEvent): boolean {
  return (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && !e.repeat && e.key.toLowerCase() === 'k' && !ehCampoDeTexto(e.target)
}

/**
 * Paleta de busca rápida (Ctrl/Cmd+K): telas do menu que o papel vê e, a partir de 2 letras, unidades, itens do
 * cardápio, informações e conversas pela busca do servidor (RLS do usuário). ↑/↓ escolhem, Enter abre, Esc fecha.
 */
export function BuscaRapida(props: { papel: StaffRole; buscar: (termo: string) => Promise<ActionResult<ResultadoBusca[]>> }) {
  const router = useRouter()
  const [aberta, setAberta] = useState(false)
  const [termo, setTermo] = useState('')
  const [busca, setBusca] = useState<Busca | null>(null)
  const [ativa, setAtiva] = useState(0)
  const seq = useRef(0)
  const buscarRef = useRef(props.buscar)
  buscarRef.current = props.buscar
  const listaId = useId()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!ehAtalhoBusca(e)) return
      e.preventDefault()
      setAberta(true)
    }
    const abrir = () => setAberta(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener(EVENTO_ABRIR_BUSCA, abrir)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener(EVENTO_ABRIR_BUSCA, abrir)
    }
  }, [])

  // servidor só a partir de 2 letras, depois de uma pausa na digitação; resposta de termo antigo é descartada
  const consulta = termo.trim()
  useEffect(() => {
    const minha = ++seq.current
    if (!aberta || consulta.length < MIN_TERMO_BUSCA) return
    const t = setTimeout(() => {
      buscarRef.current(consulta).then(
        (r) => { if (minha === seq.current) setBusca({ termo: consulta, resultados: r.ok ? (r.data ?? []) : [], erro: !r.ok }) },
        () => { if (minha === seq.current) setBusca({ termo: consulta, resultados: [], erro: true }) },
      )
    }, ESPERA_MS)
    return () => clearTimeout(t)
  }, [aberta, consulta])

  const atual = busca && busca.termo === consulta ? busca : null
  const telas = useMemo(() => telasDaBusca(props.papel, consulta), [props.papel, consulta])
  const grupos = GRUPOS.map((g) => ({ ...g, itens: (atual?.resultados ?? []).filter((r) => r.tipo === g.tipo) })).filter((g) => g.itens.length > 0)
  const opcoes: Opcao[] = [
    ...telas.map((t) => ({ chave: `tela-${t.id}`, tela: t })),
    ...grupos.flatMap((g) => g.itens.map((r) => ({ chave: `${r.tipo}-${r.id}`, resultado: r }))),
  ]
  const indice = opcoes.length === 0 ? -1 : Math.min(ativa, opcoes.length - 1)
  const idDe = (i: number) => `${listaId}-${i}`

  function mudarAberta(v: boolean) {
    setAberta(v)
    if (!v) {
      setTermo('')
      setBusca(null)
      setAtiva(0)
    }
  }

  function escolher(o: Opcao) {
    mudarAberta(false)
    if (o.tela?.acao === 'simulador') abrirSimulador()
    else if (o.tela?.href) router.push(o.tela.href)
    else if (o.resultado) router.push(hrefDoResultado(o.resultado))
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (opcoes.length === 0) return
      const passo = e.key === 'ArrowDown' ? 1 : -1
      const proxima = (indice + passo + opcoes.length) % opcoes.length
      setAtiva(proxima)
      document.getElementById(idDe(proxima))?.scrollIntoView?.({ block: 'nearest' })
    } else if (e.key === 'Enter' && indice >= 0) {
      e.preventDefault()
      escolher(opcoes[indice]!)
    }
  }

  const carregando = consulta.length >= MIN_TERMO_BUSCA && !atual
  let posicao = 0
  const opcao = (o: Opcao, conteudo: React.ReactNode) => {
    const i = posicao++
    return (
      <li
        key={o.chave}
        id={idDe(i)}
        role="option"
        aria-selected={i === indice}
        onMouseMove={() => { if (i !== indice) setAtiva(i) }}
        onClick={() => escolher(o)}
        className={cn(
          'flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm',
          i === indice ? 'bg-accent text-foreground' : 'text-foreground',
        )}
      >
        {conteudo}
      </li>
    )
  }

  return (
    <Dialog open={aberta} onOpenChange={mudarAberta}>
      <DialogContent
        showCloseButton={false}
        className="top-[12vh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        <DialogTitle className="sr-only">Busca rápida</DialogTitle>
        <DialogDescription className="sr-only">
          Digite para achar telas, unidades, itens do cardápio, informações e conversas. Setas escolhem, Enter abre, Esc fecha.
        </DialogDescription>
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <input
            role="combobox"
            aria-label="Buscar no painel"
            aria-expanded="true"
            aria-controls={listaId}
            aria-autocomplete="list"
            aria-activedescendant={indice >= 0 ? idDe(indice) : undefined}
            autoComplete="off"
            spellCheck={false}
            maxLength={60}
            placeholder="Buscar telas, unidades, cardápio, conversas…"
            value={termo}
            onChange={(e) => { setTermo(e.target.value); setAtiva(0) }}
            onKeyDown={onKeyDown}
            className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
          <kbd aria-hidden="true" className="font-mono text-[11px] text-muted-foreground">Esc</kbd>
        </div>
        <div className="max-h-[min(60vh,28rem)] overflow-y-auto p-2">
          <ul id={listaId} role="listbox" aria-label="Resultados da busca" className="flex flex-col gap-1">
            {telas.length > 0 && (
              <li role="presentation">
                <ul role="group" aria-label="Telas" className="flex flex-col">
                  <li role="presentation" aria-hidden="true" className="px-3 pb-1 pt-2 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Telas</li>
                  {telas.map((t) => {
                    const Icone = t.icone
                    return opcao({ chave: `tela-${t.id}`, tela: t }, (
                      <>
                        <Icone aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{t.rotulo}</span>
                      </>
                    ))
                  })}
                </ul>
              </li>
            )}
            {grupos.map((g) => (
              <li key={g.tipo} role="presentation">
                <ul role="group" aria-label={g.rotulo} className="flex flex-col">
                  <li role="presentation" aria-hidden="true" className="px-3 pb-1 pt-2 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">{g.rotulo}</li>
                  {g.itens.map((r) => opcao({ chave: `${r.tipo}-${r.id}`, resultado: r }, (
                    <>
                      <g.icone aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{r.titulo}</span>
                      {r.detalhe && <span className="max-w-[40%] shrink-0 truncate text-xs text-muted-foreground">{r.detalhe}</span>}
                      {r.simulada && <SeloSimulacao />}
                    </>
                  )))}
                </ul>
              </li>
            ))}
          </ul>
          <p role="status" className={cn('px-3 py-2 text-sm text-muted-foreground', !carregando && !atual?.erro && opcoes.length > 0 && 'sr-only')}>
            {carregando
              ? 'Buscando…'
              : atual?.erro
                ? 'Não foi possível buscar agora. Tente de novo.'
                : opcoes.length === 0
                  ? `Nada encontrado para “${consulta}”.`
                  : `${opcoes.length} ${opcoes.length === 1 ? 'resultado' : 'resultados'}`}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
