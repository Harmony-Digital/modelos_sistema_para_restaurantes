'use client'
import { FileText, MapPin } from 'lucide-react'
import { z } from 'zod'
import type { MensagemInbox } from '@atd/db'
import { agoraLocal } from '@atd/core/s1'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Mensagem da DAL + título/URL assinada do arquivo do cardápio (documento/imagem), resolvidos no servidor. */
export type MensagemTelaInbox = MensagemInbox & { midia?: { titulo: string; url: string | null } }

const localizacao = z.object({ lat: z.number(), lng: z.number(), nome: z.string(), endereco: z.string() })
const lista = z.object({ opcoes: z.array(z.object({ titulo: z.string() })) })

const dois = (n: number) => String(n).padStart(2, '0')
function hora(d: Date, timezone: string) {
  const m = agoraLocal(new Date(d), timezone).minuto
  return `${dois(Math.floor(m / 60))}:${dois(m % 60)}`
}

function autorDe(m: MensagemTelaInbox): string {
  if (m.direcao === 'in') return 'Cliente'
  if (m.autor === 'ia') return 'IA'
  if (m.autor === 'humano') return m.atendente ?? 'Equipe'
  if (m.autor === 'sistema') return 'Sistema'
  return 'Cliente'
}

/** Situação do envio de uma mensagem nossa (worker e webhook de status da Meta). */
function envio(s: string | null): { rotulo: string; falhou: boolean } | null {
  if (!s) return null
  // `failed:<código>`: linhas antigas do webhook (hoje normalizadas para `falhou:<código>`)
  if (s.startsWith('falhou:') || s === 'failed' || s.startsWith('failed:')) return { rotulo: 'Não enviada', falhou: true }
  const r: Record<string, string> = {
    pendente: 'Enviando…', enviado: 'Enviada', sent: 'Enviada', delivered: 'Entregue', read: 'Lida',
    simulado: 'Simulada (não sai pelo WhatsApp)', cancelado: 'Cancelada',
  }
  return r[s] ? { rotulo: r[s], falhou: false } : null
}

function Conteudo({ m }: { m: MensagemTelaInbox }) {
  if (m.tipo === 'audio') {
    return m.transcrito && m.texto
      ? <p className="whitespace-pre-wrap break-words">🎤 <em>{m.texto}</em></p>
      : <p className="text-muted-foreground">🎤 Áudio (não transcrito)</p>
  }
  if ((m.tipo === 'documento' || m.tipo === 'imagem') && m.direcao === 'out') {
    const titulo = m.midia?.titulo ?? 'Arquivo do cardápio'
    return (
      <div className="flex flex-col gap-1">
        <p className="flex items-center gap-2 font-medium"><FileText aria-hidden="true" className="size-5 shrink-0" />{titulo}</p>
        {m.midia?.url
          ? <a href={m.midia.url} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-11 items-center text-sm font-medium text-link underline-offset-4 [@media(hover:hover)]:hover:underline">Abrir {titulo}</a>
          : <p className="text-sm text-muted-foreground">Arquivo indisponível na prévia</p>}
        {m.texto && <p className="whitespace-pre-wrap break-words">{m.texto}</p>}
      </div>
    )
  }
  if (m.tipo === 'localizacao') {
    const p = localizacao.safeParse(m.payload)
    if (p.success) {
      return (
        <div className="flex flex-col gap-0.5">
          <p className="flex items-center gap-2 font-medium"><MapPin aria-hidden="true" className="size-5 shrink-0" />{p.data.nome}</p>
          <p className="text-sm text-muted-foreground">{p.data.endereco}</p>
          <a
            href={`https://www.google.com/maps?q=${p.data.lat},${p.data.lng}`}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex min-h-11 items-center text-sm font-medium text-link underline-offset-4 [@media(hover:hover)]:hover:underline"
          >
            Abrir no Maps
          </a>
        </div>
      )
    }
  }
  if (m.tipo === 'lista') {
    const p = lista.safeParse(m.payload)
    return (
      <div className="flex flex-col gap-1">
        {m.texto && <p className="whitespace-pre-wrap break-words">{m.texto}</p>}
        {p.success && (
          <ul className="list-inside list-disc text-sm text-muted-foreground">
            {p.data.opcoes.map((o, i) => <li key={i}>{o.titulo}</li>)}
          </ul>
        )}
      </div>
    )
  }
  if (m.texto) return <p className="whitespace-pre-wrap break-words">{m.texto}</p>
  return <p className="text-muted-foreground">(mensagem sem texto)</p>
}

export function Bolha(props: { m: MensagemTelaInbox; timezone: string; onTentarDeNovo?: (messageId: number) => void; tentando?: boolean }) {
  const { m } = props
  const autor = autorDe(m)
  const h = hora(m.createdAt, props.timezone)
  const doCliente = m.direcao === 'in'
  const sistema = m.direcao === 'out' && m.autor === 'sistema'
  const e = m.direcao === 'out' ? envio(m.statusEnvio) : null
  return (
    <article
      aria-label={`${autor} às ${h}`}
      className={cn(
        'flex max-w-[85%] flex-col gap-1 rounded-lg px-3 py-2 text-[15px] leading-snug',
        doCliente && 'mr-auto rounded-tl-none border border-border bg-card text-card-foreground',
        !doCliente && !sistema && 'ml-auto rounded-tr-none bg-secondary text-secondary-foreground',
        sistema && 'mx-auto border border-dashed border-border bg-background text-muted-foreground',
      )}
    >
      <p className="text-xs font-semibold text-muted-foreground">{autor}</p>
      <Conteudo m={m} />
      <p className="flex flex-wrap items-center justify-end gap-x-2 text-xs text-muted-foreground">
        <span>{h}</span>
        {e && <span className={cn(e.falhou && 'font-medium text-destructive')}>{e.rotulo}</span>}
      </p>
      {e?.falhou && m.autor === 'humano' && props.onTentarDeNovo && (
        <Button
          type="button"
          variant="outline"
          className="self-end"
          disabled={props.tentando}
          aria-busy={props.tentando || undefined}
          onClick={() => props.onTentarDeNovo?.(m.id)}
        >
          Tentar de novo
        </Button>
      )}
    </article>
  )
}
