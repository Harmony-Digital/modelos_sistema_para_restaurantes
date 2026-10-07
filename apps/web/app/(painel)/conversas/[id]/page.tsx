import { ArrowLeft } from 'lucide-react'
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
import { getDb } from '@/lib/server/db'
import { midiasDasMensagens } from '@/lib/server/midias-conversa'
import { arquivoDaMensagem } from '@/lib/simulador-tela'
import {
  assumirAction, devolverAction, encerrarAction, mostrarTelefoneConversaAction, reenviarAction, responderAction,
} from '../actions'

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

export default async function ConversaPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ antes?: string }> }) {
  const session = await requireStaff(['dono', 'gerente', 'atendente'])
  const { id } = await props.params
  const { antes } = await props.searchParams
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
  const maisAntigas = r.mensagens.length === POR_PAGINA && primeira ? `/conversas/${id}?antes=${primeira.id}` : null
  const c = r.conversa
  return (
    <>
      <TopBar
        title={c.nome ?? 'Cliente sem nome'}
        subtitle={c.unidade ?? 'Unidade não definida'}
        action={
          <Link href="/conversas" aria-label="Voltar para Conversas" className="inline-flex size-11 items-center justify-center rounded-md [@media(hover:hover)]:hover:bg-accent">
            <ArrowLeft aria-hidden="true" className="size-5" />
          </Link>
        }
      />
      <main className="mx-auto flex max-w-xl lg:mx-0 lg:max-w-6xl lg:px-8 flex-col gap-4 px-4 py-6">
        <EscutarConversa topico={topicoConversa(c.id)} />
        {antesDe !== undefined && (
          <Link href={`/conversas/${id}`} className="inline-flex min-h-11 items-center self-center text-sm font-medium text-link">
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
      </main>
    </>
  )
}
