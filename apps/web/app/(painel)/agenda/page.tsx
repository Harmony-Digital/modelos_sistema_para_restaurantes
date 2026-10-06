import { carregarUnidadesPainel, contarPedidosNovos, listarPedidos, membrosDaEquipe, previsaoDoDia } from '@atd/db'
import { Abas } from '@/components/painel/abas'
import { Eventos } from '@/components/painel/eventos'
import { Previsao } from '@/components/painel/previsao'
import { TopBar } from '@/components/shell/top-bar'
import { requireStaff } from '@/lib/dal'
import { statusDaUrl } from '@/lib/eventos'
import { dataDaUrl, hojeLocal } from '@/lib/previsao'
import { getDb } from '@/lib/server/db'

export const dynamic = 'force-dynamic'

type Busca = { aba?: string; data?: string; unidade?: string; cancelados?: string; status?: string }

export default async function AgendaPage(props: { searchParams: Promise<Busca> }) {
  const s = await requireStaff()
  const q = await props.searchParams
  const aba = q.aba === 'eventos' ? 'eventos' : 'previsao'
  const novos = await contarPedidosNovos(getDb(), s.claims)
  const abas = (
    <Abas
      rotulo="Seções da agenda"
      itens={[
        { href: '/agenda?aba=previsao', rotulo: 'Previsão', ativo: aba === 'previsao' },
        { href: '/agenda?aba=eventos', rotulo: novos > 0 ? `Eventos (${novos} ${novos === 1 ? 'novo' : 'novos'})` : 'Eventos', ativo: aba === 'eventos' },
      ]}
    />
  )

  if (aba === 'eventos') {
    const status = statusDaUrl(q.status)
    const { unidades } = await carregarUnidadesPainel(getDb(), s.claims)
    const opcoes = unidades.filter((u) => u.ativo).map((u) => ({ id: u.id, nome: u.nome }))
    const unidade = opcoes.some((u) => u.id === q.unidade) ? (q.unidade ?? null) : null
    const [pedidos, membros] = await Promise.all([
      listarPedidos(getDb(), s.claims, { status, unitId: unidade }),
      membrosDaEquipe(getDb(), s.claims),
    ])
    return (
      <>
        <TopBar title="Agenda" subtitle="Pedidos de evento dos clientes" />
        <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
          {abas}
          <Eventos pedidos={pedidos} unidades={opcoes} status={status} unidade={unidade} membros={membros} agora={new Date()} />
        </main>
      </>
    )
  }

  const hoje = hojeLocal(new Date())
  const data = dataDaUrl(q.data, hoje)
  const mostrarCancelados = q.cancelados === '1'
  const unidades = await previsaoDoDia(getDb(), s.claims, { data, incluirCancelados: mostrarCancelados })
  const filtro = unidades.some((u) => u.unitId === q.unidade) ? (q.unidade ?? null) : null
  return (
    <>
      <TopBar title="Agenda" subtitle="Quem avisou que vai ao restaurante" />
      <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
        {abas}
        <Previsao data={data} hoje={hoje} unidades={unidades} filtro={filtro} mostrarCancelados={mostrarCancelados} podeEditar={s.role !== 'atendente'} />
      </main>
    </>
  )
}
