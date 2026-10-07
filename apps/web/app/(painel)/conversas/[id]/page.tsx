import { ArrowLeft, X } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { lerConversa, listarRespostasRapidas, schema } from '@atd/db'
import { Conversa } from '@/components/conversas/conversa'
import type { MensagemTelaInbox } from '@/components/conversas/bolha'
import { EscutarConversa } from '@/components/conversas/escutar-conversa'
import { TopBar } from '@/components/shell/top-bar'
import { requireStaff } from '@/lib/dal'
import { topicoConversa } from '@/lib/conversas'
import { colunaDetalhe, hrefLista } from '@/lib/lista-detalhe'
import { getDb } from '@/lib/server/db'
import { midiasDasMensagens } from '@/lib/server/midias-conversa'
import { arquivoDaMensagem } from '@/lib/simulador-tela'
import {
  assumirAction, devolverAction, encerrarAction, mostrarTelefoneConversaAction, reenviarAction, responderAction,
} from '../actions'
import type { BuscaConversas } from '../coluna-lista'

export const dynamic = 'force-dynamic'

const POR_PAGINA = 50
const acoes = {
  assumir: assumirAction,
  responder: responderAction,
  reenviar: reenviarAction,
  devolver: devolverAction,
  encerrar: encerrarAction,
  mostrarTelefone: mostrarTelefoneConversaAction,
}

export default async function ConversaPage(props: { params: Promise<{ id: string }>; searchParams: Promise<BuscaConversas & { antes?: string }> }) {
  const session = await requireStaff(['dono', 'gerente', 'atendente'])
  const { id } = await props.params
  const sp = await props.searchParams
  const { antes } = sp
  const antesDe = antes && /^\d{1,15}$/.test(antes) ? Number(antes) : undefined
  const db = getDb()
  const r = await lerConversa(db, session.claims, id, antesDe !== undefined ? { antesDe } : {})
  if (!r) notFound()
  const [respostas, [rest]] = await Promise.all([
    listarRespostasRapidas(db, session.claims),
    db.select({ timezone: schema.restaurants.timezone }).from(schema.restaurants).where(eq(schema.restaurants.id, session.restaurantId)),
  ])
  const midias = await midiasDasMensagens(session.claims, r.mensagens)
  const mensagens: MensagemTelaInbox[] = r.mensagens.map((m) => {
    const arquivo = arquivoDaMensagem(m)
    const midia = arquivo ? midias.get(arquivo) : undefined
    return midia ? { ...m, midia } : m
  })
  const primeira = r.mensagens[0]
  // os filtros da lista ao lado seguem em todos os links (mensagens anteriores, voltar, fechar)
  const maisAntigas = r.mensagens.length === POR_PAGINA && primeira ? hrefLista(`/conversas/${id}`, sp, { antes: String(primeira.id) }) : null
  const voltar = hrefLista('/conversas', sp)
  const c = r.conversa
  const nome = c.nome ?? 'Cliente sem nome'
  const unidade = c.unidade ?? 'Unidade não definida'
  return (
    <section aria-label={`Conversa com ${nome}`} className={colunaDetalhe(true)}>
      <TopBar
        title={nome}
        subtitle={unidade}
        className="lg:hidden" semFaixa
        action={
          <Link href={voltar} aria-label="Voltar para Conversas" className="inline-flex size-11 items-center justify-center rounded-md [@media(hover:hover)]:hover:bg-accent">
            <ArrowLeft aria-hidden="true" className="size-5" />
          </Link>
        }
      />
      {/* ≥ lg: cabeçalho da coluna (a barra da tela é a do layout, "Conversas") */}
      <header className="sticky top-0 z-20 hidden items-center gap-3 border-b border-border bg-background/95 px-6 py-3 backdrop-blur lg:flex">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold tracking-tight text-foreground">{nome}</h2>
          <p className="truncate text-sm text-muted-foreground">{unidade}</p>
        </div>
        <Link
          href={voltar}
          scroll={false}
          aria-label="Fechar conversa"
          aria-keyshortcuts="Escape"
          title="Fechar (Esc)"
          className="inline-flex size-11 items-center justify-center rounded-md text-muted-foreground [@media(hover:hover)]:hover:bg-accent [@media(hover:hover)]:hover:text-foreground"
        >
          <X aria-hidden="true" className="size-5" />
        </Link>
      </header>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-6 lg:max-w-3xl lg:px-6">
        <EscutarConversa topico={topicoConversa(c.id)} />
        {antesDe !== undefined && (
          <Link href={hrefLista(`/conversas/${id}`, sp)} className="inline-flex min-h-11 items-center self-center text-sm font-medium text-link">
            Ver mensagens mais recentes
          </Link>
        )}
        <Conversa
          conversa={{
            id: c.id, nome: c.nome, unidade: c.unidade, estado: c.estado, atendente: c.atendente, atendenteId: c.atendenteId,
            janelaAte: c.janelaAte, simulada: c.simulada, handoffMotivo: c.handoffMotivo,
          }}
          mensagens={mensagens}
          meuId={session.userId}
          papel={session.role}
          timezone={rest?.timezone ?? 'America/Sao_Paulo'}
          respostasRapidas={respostas.filter((q) => q.ativo)}
          maisAntigas={maisAntigas}
          acoes={acoes}
        />
      </div>
    </section>
  )
}
