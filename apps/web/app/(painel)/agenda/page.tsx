import { redirect } from 'next/navigation'
import { listarPedidos, membrosDaEquipe, previsaoDoDia } from '@atd/db'
import { AgendaDia } from '@/components/painel/agenda-dia'
import { TopBar } from '@/components/shell/top-bar'
import { diaDaAgenda, hrefDaAgendaAntiga, statusDaAgenda, type BuscaAgenda } from '@/lib/agenda'
import { requireStaff } from '@/lib/dal'
import { hojeLocal } from '@/lib/previsao'
import { getDb } from '@/lib/server/db'

export const dynamic = 'force-dynamic'

/**
 * Agenda única por dia: avisos de presença e pedidos de evento numa linha do tempo, pedido aberto ao lado (lg+) ou em
 * folha. A junção é feita aqui, com as duas leituras da DAL (RLS por unidade e modo demonstração já aplicados nelas).
 */
export default async function AgendaPage(props: { searchParams: Promise<BuscaAgenda> }) {
  const q = await props.searchParams
  const antiga = hrefDaAgendaAntiga(q)
  if (antiga) redirect(antiga)

  const s = await requireStaff()
  const hoje = hojeLocal(new Date())
  const dia = diaDaAgenda(q.dia, hoje)
  const cancelados = q.cancelados === '1'
  const [unidades, membros] = await Promise.all([
    previsaoDoDia(getDb(), s.claims, { data: dia, incluirCancelados: cancelados }),
    membrosDaEquipe(getDb(), s.claims),
  ])
  // só unidade ativa e visível vale como filtro; o resto vira "todas"
  const unidade = q.unidade && unidades.some((u) => u.unitId === q.unidade) ? q.unidade : null
  const pedidos = await listarPedidos(getDb(), s.claims, { status: statusDaAgenda(cancelados), unitId: unidade })

  return (
    <>
      <TopBar title="Agenda" subtitle="Quem vem e quem pediu evento, dia a dia" />
      <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6 lg:mx-0 lg:max-w-6xl lg:px-8">
        <AgendaDia
          dia={dia}
          hoje={hoje}
          unidades={unidades}
          pedidos={pedidos}
          unidade={unidade}
          cancelados={cancelados}
          pedidoId={q.pedido ?? null}
          membros={membros}
          podeEditar={s.role !== 'atendente'}
          agora={new Date()}
        />
      </main>
    </>
  )
}
