import { getPanelStatus } from '@atd/db'
import { requireStaff } from '@/lib/dal'
import { getDb } from '@/lib/server/db'

export const dynamic = 'force-dynamic'

const ONLINE_MS = 60_000

export default async function StatusPage() {
  const session = await requireStaff()
  const s = await getPanelStatus(getDb(), session.claims)
  const online = s.workerLastSeen !== null && Date.now() - s.workerLastSeen.getTime() < ONLINE_MS
  const veCusto = session.role !== 'atendente'
  return (
    <main className="grid gap-4 sm:grid-cols-2">
      <section className="rounded border bg-white p-4">
        <h2 className="text-sm text-neutral-600">IA</h2>
        <p className={online ? 'text-lg font-semibold text-green-700' : 'text-lg font-semibold text-red-700'}>
          {online ? 'Online' : 'Offline'}
        </p>
      </section>
      <section className="rounded border bg-white p-4">
        <h2 className="text-sm text-neutral-600">Conversas abertas</h2>
        <p className="text-lg font-semibold">{s.conversasAbertas}</p>
        <p className="text-sm text-neutral-600">{s.aguardandoHumano} aguardando atendente</p>
      </section>
      {veCusto && (
        <section className="rounded border bg-white p-4">
          <h2 className="text-sm text-neutral-600">Gasto de IA hoje</h2>
          <p className="text-lg font-semibold">US$ {Number(s.gastoIaHojeUsd ?? 0).toFixed(4)}</p>
        </section>
      )}
    </main>
  )
}
