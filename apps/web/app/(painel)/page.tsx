import { getPanelStatus, listAwaitingHuman } from '@atd/db'
import { AwaitingHuman } from '@/components/conversations/awaiting-human'
import { StatCard } from '@/components/home/stat-card'
import { TopBar } from '@/components/shell/top-bar'
import { requireStaff } from '@/lib/dal'
import { getDb } from '@/lib/server/db'
import { returnToAiAction } from './actions'

export const dynamic = 'force-dynamic'

const ONLINE_MS = 60_000
const usd = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 4 })

export default async function InicioPage() {
  const session = await requireStaff()
  const s = await getPanelStatus(getDb(), session.claims)
  const online = s.workerLastSeen !== null && Date.now() - s.workerLastSeen.getTime() < ONLINE_MS
  return (
    <>
      <TopBar title="Início" subtitle="Como está o atendimento agora" />
      <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="IA" value={online ? 'Online' : 'Offline'} tone={online ? 'ok' : 'alerta'} hint={online ? 'Respondendo clientes' : 'Verifique o worker'} />
          <StatCard label="Conversas abertas" value={String(s.conversasAbertas)} hint={`${s.aguardandoHumano} aguardando atendente`} />
          {session.role !== 'atendente' && (
            <StatCard label="Gasto de IA hoje" value={usd.format(Number(s.gastoIaHojeUsd ?? 0))} />
          )}
        </div>
        <AwaitingHuman itens={await listAwaitingHuman(getDb(), session.claims)} action={returnToAiAction} />
      </main>
    </>
  )
}
