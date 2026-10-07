import { ChevronRight, Store } from 'lucide-react'
import Link from 'next/link'
import { carregarUnidadesPainel } from '@atd/db'
import { NovaUnidade } from '@/components/painel/nova-unidade'
import { SeloUnidade } from '@/components/painel/selo-unidade'
import { EmptyState } from '@/components/shell/empty-state'
import { TopBar } from '@/components/shell/top-bar'
import { requireStaff } from '@/lib/dal'
import { seloDaUnidade } from '@/lib/selo-unidade'
import { getDb } from '@/lib/server/db'

export const dynamic = 'force-dynamic'

export default async function UnidadesPage() {
  const s = await requireStaff()
  const { restaurante, unidades } = await carregarUnidadesPainel(getDb(), s.claims)
  const podeEditar = s.role !== 'atendente'
  const agora = new Date()
  return (
    <>
      <TopBar title="Unidades" subtitle="Endereços, horários e exceções" action={podeEditar && unidades.length > 0 ? <NovaUnidade /> : undefined} />
      <main className="mx-auto max-w-xl px-4 py-6 lg:mx-0 lg:max-w-6xl lg:px-8">
        {unidades.length === 0 ? (
          <EmptyState
            icon={Store}
            title="Cadastre a primeira unidade"
            description="Endereço, horários e feriados de cada unidade são o que a IA usa para responder os clientes."
            action={podeEditar ? <NovaUnidade /> : undefined}
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {unidades.map((u) => (
              <li key={u.id}>
                <Link
                  href={`/unidades/${u.id}`}
                  className="flex min-h-16 items-center gap-3 rounded-lg border border-border bg-card p-4 transition-colors duration-150 [@media(hover:hover)]:hover:border-ring"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-foreground">{u.nome}</p>
                    <p className="truncate text-sm text-muted-foreground">{u.endereco ?? u.bairro ?? 'Endereço não cadastrado'}</p>
                    <div className="mt-1">
                      <SeloUnidade selo={seloDaUnidade(u, restaurante.politicaFeriado, restaurante.timezone, agora)} />
                    </div>
                  </div>
                  <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  )
}
