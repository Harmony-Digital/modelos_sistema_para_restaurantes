'use client'
import { Check, CheckCheck, Clock3, FileText, List, MapPin } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { WA } from './colors'
import type { SimMessage, SimStatus } from './types'

function Status({ s }: { s?: SimStatus | undefined }) {
  if (!s) return null
  const rotulo = { enviando: 'Enviando', enviada: 'Enviada', entregue: 'Entregue', lida: 'Lida' }[s]
  return (
    <>
      {s === 'enviando' && <Clock3 aria-hidden="true" className="size-3.5" />}
      {s === 'enviada' && <Check aria-hidden="true" className="size-4" />}
      {(s === 'entregue' || s === 'lida') && (
        <CheckCheck aria-hidden="true" className="size-4" style={{ color: s === 'lida' ? WA.lida : WA.meta }} />
      )}
      <span className="sr-only">{rotulo}</span>
    </>
  )
}

function Hora({ hora, status }: { hora: string; status?: SimStatus | undefined }) {
  return (
    <span className="ml-2 inline-flex translate-y-1 items-center gap-1 float-right text-[11px]" style={{ color: WA.meta }}>
      {hora}<Status s={status} />
    </span>
  )
}

type Secoes = Extract<SimMessage, { tipo: 'lista' }>['secoes']

/** Painel de opções: foco entra ao abrir, Esc fecha só o painel, Cancelar visível. */
function ListaSheet(props: { titulo: string; secoes: Secoes; onFechar: () => void; onEscolher: (itemId: string, titulo: string) => void }) {
  const tituloId = useId()
  const painel = useRef<HTMLDivElement>(null)
  const fechar = useRef(props.onFechar)
  fechar.current = props.onFechar
  useEffect(() => {
    const el = painel.current
    const focaveis = () => Array.from(el?.querySelectorAll<HTMLButtonElement>('button') ?? [])
    focaveis()[0]?.focus()
    // captura em window: roda antes do Esc do Radix (document), mantendo o simulador aberto
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        fechar.current()
        return
      }
      if (e.key !== 'Tab') return
      const fs = focaveis()
      const primeiro = fs[0]
      const ultimo = fs[fs.length - 1]
      if (!primeiro || !ultimo) return
      const ativo = document.activeElement
      if (e.shiftKey && (ativo === primeiro || !el?.contains(ativo))) { e.preventDefault(); ultimo.focus() }
      else if (!e.shiftKey && (ativo === ultimo || !el?.contains(ativo))) { e.preventDefault(); primeiro.focus() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  return (
    <div
      ref={painel}
      role="dialog"
      aria-modal="true"
      aria-labelledby={tituloId}
      className="fixed inset-x-0 bottom-0 z-10 max-h-[70%] overflow-y-auto rounded-t-2xl p-4"
      style={{ background: WA.barra }}
    >
      <p id={tituloId} className="sr-only">{props.titulo}</p>
      {props.secoes.map((sec, i) => (
        <section key={i}>
          <h3 className="mb-2 text-sm font-semibold" style={{ color: '#00A884' }}>{sec.titulo}</h3>
          <ul>
            {sec.itens.map((it) => (
              <li key={it.id}>
                <button
                  type="button"
                  onClick={() => props.onEscolher(it.id, it.titulo)}
                  className="flex min-h-12 w-full flex-col items-start justify-center border-b py-2 text-left"
                  style={{ borderColor: '#2A3942', color: WA.texto }}
                >
                  <span>{it.titulo}</span>
                  {it.descricao && <span className="text-sm" style={{ color: WA.meta }}>{it.descricao}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <button type="button" onClick={props.onFechar} className="mt-2 min-h-11 w-full rounded-lg text-[15px] font-medium" style={{ color: WA.lida }}>
        Cancelar
      </button>
    </div>
  )
}

export function Bubble(props: { m: SimMessage; onEscolher: (mensagemId: string, itemId: string, titulo: string) => void }) {
  const { m } = props
  const [listaAberta, setListaAberta] = useState(false)
  const botaoRef = useRef<HTMLButtonElement>(null)
  if (m.tipo === 'aviso') {
    return (
      <p className="mx-auto my-2 max-w-[85%] rounded-lg px-3 py-1.5 text-center text-xs" style={{ background: '#182229', color: WA.meta }}>
        {m.link && m.texto.includes(m.link.rotulo) ? (
          <>
            {m.texto.slice(0, m.texto.indexOf(m.link.rotulo))}
            <Link href={m.link.href} className="underline underline-offset-2">{m.link.rotulo}</Link>
            {m.texto.slice(m.texto.indexOf(m.link.rotulo) + m.link.rotulo.length)}
          </>
        ) : m.texto}
      </p>
    )
  }
  const doCliente = m.de === 'cliente'
  return (
    <article
      className={`relative my-1 max-w-[82%] rounded-lg px-2.5 py-1.5 text-[15px] leading-snug shadow-sm ${doCliente ? 'ml-auto rounded-tr-none' : 'mr-auto rounded-tl-none'}`}
      style={{ background: doCliente ? WA.balaoCliente : WA.balaoRestaurante, color: WA.texto }}
    >
      {m.tipo === 'texto' && (<p className="whitespace-pre-wrap break-words">{m.texto}<Hora hora={m.hora} status={m.status} /></p>)}

      {m.tipo === 'localizacao' && (
        <div className="w-60">
          <div className="flex h-28 items-center justify-center rounded-md" style={{ background: '#2A3942' }}>
            <MapPin aria-hidden="true" className="size-8" style={{ color: '#F15C6D' }} />
          </div>
          <p className="mt-1.5 font-medium">{m.nome}</p>
          <p className="text-sm" style={{ color: WA.meta }}>{m.endereco}</p>
          <a
            href={`https://www.google.com/maps?q=${m.lat},${m.lng}`}
            target="_blank"
            rel="noreferrer"
            className="mt-1 block text-sm font-medium"
            style={{ color: WA.lida }}
          >
            Abrir no Maps
          </a>
          <Hora hora={m.hora} />
        </div>
      )}

      {m.tipo === 'documento' && (
        <div className="w-60">
          <div className="flex items-center gap-2 rounded-md p-2" style={{ background: '#2A3942' }}>
            <FileText aria-hidden="true" className="size-8 shrink-0" style={{ color: '#F15C6D' }} />
            <p className="min-w-0 break-words font-medium">{m.titulo}</p>
          </div>
          {m.url
            ? (
              <a href={m.url} target="_blank" rel="noreferrer noopener" className="mt-1 block text-sm font-medium" style={{ color: WA.lida }}>
                Abrir
              </a>
            )
            : <p className="mt-1 text-sm" style={{ color: WA.meta }}>Arquivo indisponível na prévia</p>}
          <Hora hora={m.hora} />
        </div>
      )}

      {m.tipo === 'imagem' && (
        <div className="w-60">
          {m.url
            // URL assinada do Storage (externa e curta): <img> simples, sem otimização do Next
            ? <img src={m.url} alt={m.legenda} className="max-h-80 w-full rounded-md object-cover" />
            : <p className="rounded-md p-2 text-sm" style={{ background: '#2A3942', color: WA.meta }}>Arquivo indisponível na prévia</p>}
          {m.legenda && <p className="mt-1.5 whitespace-pre-wrap break-words">{m.legenda}</p>}
          <Hora hora={m.hora} />
        </div>
      )}

      {m.tipo === 'lista' && (
        <div className="w-64">
          <p className="whitespace-pre-wrap">{m.texto}<Hora hora={m.hora} /></p>
          <button
            ref={botaoRef}
            type="button"
            onClick={() => setListaAberta(true)}
            className="mt-2 flex w-full items-center justify-center gap-2 border-t pt-2 text-[15px] font-medium"
            style={{ borderColor: '#2A3942', color: WA.lida }}
          >
            <List aria-hidden="true" className="size-4" />{m.botao}
          </button>
          {listaAberta && (
            <ListaSheet
              titulo={m.botao}
              secoes={m.secoes}
              onFechar={() => { setListaAberta(false); botaoRef.current?.focus() }}
              onEscolher={(itemId, titulo) => { setListaAberta(false); botaoRef.current?.focus(); props.onEscolher(m.id, itemId, titulo) }}
            />
          )}
        </div>
      )}
    </article>
  )
}
