import { Store } from 'lucide-react'
import { EmptyState } from '@/components/shell/empty-state'
import { TopBar } from '@/components/shell/top-bar'
import { requireStaff } from '@/lib/dal'

export const dynamic = 'force-dynamic'

export default async function UnidadesPage() {
  await requireStaff()
  return (
    <>
      <TopBar title="Unidades" subtitle="Endereços, horários e exceções" />
      <main className="mx-auto max-w-xl px-4 py-6">
        <EmptyState
          icon={Store}
          title="Cadastro de unidades em preparação"
          description="Aqui você vai cadastrar endereço, horários e feriados de cada unidade — é o que a IA usa para responder os clientes."
        />
      </main>
    </>
  )
}
