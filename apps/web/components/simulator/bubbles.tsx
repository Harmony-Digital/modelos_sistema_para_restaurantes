'use client'
import { Check, CheckCheck, Clock3, List, MapPin } from 'lucide-react'
import { useState } from 'react'
import type { SimMessage, SimStatus } from './types'

export const WA = {
  fundo: '#0B141A', barra: '#202C33', balaoCliente: '#005C4B', balaoRestaurante: '#202C33',
  texto: '#E9EDEF', meta: '#8696A0', lida: '#53BDEB', verde: '#25D366',
} as const

function Status({ s }: { s?: SimStatus | undefined }) {
  if (!s) return null
  if (s === 'enviando') return <Clock3 aria-label="Enviando" className="size-3.5" />
  if (s === 'enviada') return <Check aria-label="Enviada" className="size-4" />
  return <CheckCheck aria-label={s === 'lida' ? 'Lida' : 'Entregue'} className="size-4" style={{ color: s === 'lida' ? WA.lida : WA.meta }} />
}

function Hora({ hora, status }: { hora: string; status?: SimStatus | undefined }) {
  return (
    <span className="ml-2 inline-flex translate-y-1 items-center gap-1 float-right text-[11px]" style={{ color: WA.meta }}>
      {hora}<Status s={status} />
    </span>
  )
}

export function Bubble(props: { m: SimMessage; onEscolher: (mensagemId: string, itemId: string, titulo: string) => void }) {
  const { m } = props
  const [listaAberta, setListaAberta] = useState(false)
  if (m.tipo === 'aviso') {
    return (
      <p className="mx-auto my-2 max-w-[85%] rounded-lg px-3 py-1.5 text-center text-xs" style={{ background: '#182229', color: WA.meta }}>
        {m.texto}
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

      {m.tipo === 'lista' && (
        <div className="w-64">
          <p className="whitespace-pre-wrap">{m.texto}<Hora hora={m.hora} /></p>
          <button
            type="button"
            onClick={() => setListaAberta(true)}
            className="mt-2 flex w-full items-center justify-center gap-2 border-t pt-2 text-[15px] font-medium"
            style={{ borderColor: '#2A3942', color: WA.lida }}
          >
            <List aria-hidden="true" className="size-4" />{m.botao}
          </button>
          {listaAberta && (
            <div role="dialog" aria-label={m.botao} className="fixed inset-x-0 bottom-0 z-10 rounded-t-2xl p-4" style={{ background: WA.barra }}>
              {m.secoes.map((sec) => (
                <section key={sec.titulo}>
                  <h3 className="mb-2 text-sm font-semibold" style={{ color: '#00A884' }}>{sec.titulo}</h3>
                  <ul>
                    {sec.itens.map((it) => (
                      <li key={it.id}>
                        <button
                          type="button"
                          onClick={() => { setListaAberta(false); props.onEscolher(m.id, it.id, it.titulo) }}
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
            </div>
          )}
        </div>
      )}
    </article>
  )
}
