import { previsaoDoDia } from '@atd/db'
import { Previsao } from '@/components/painel/previsao'
import { TopBar } from '@/components/shell/top-bar'
import { requireStaff } from '@/lib/dal'
import { dataDaUrl, hojeLocal } from '@/lib/previsao'
import { getDb } from '@/lib/server/db'

export const dynamic = 'force-dynamic'

export default async function PrevisaoPage(props: { searchParams: Promise<{ data?: string; unidade?: string; cancelados?: string }> }) {
  const s = await requireStaff()
  const q = await props.searchParams
  const hoje = hojeLocal(new Date())
  const data = dataDaUrl(q.data, hoje)
  const mostrarCancelados = q.cancelados === '1'
  const unidades = await previsaoDoDia(getDb(), s.claims, { data, incluirCancelados: mostrarCancelados })
  const filtro = unidades.some((u) => u.unitId === q.unidade) ? (q.unidade ?? null) : null
  return (
    <>
      <TopBar title="Previsão" subtitle="Quem avisou que vai ao restaurante" />
      <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
        <Previsao data={data} hoje={hoje} unidades={unidades} filtro={filtro} mostrarCancelados={mostrarCancelados} podeEditar={s.role !== 'atendente'} />
      </main>
    </>
  )
}
