import { ChevronRight, Store } from 'lucide-react'
import Link from 'next/link'
import { carregarUnidadesPainel } from '@atd/db'
import { NovaUnidade } from '@/components/painel/nova-unidade'
import { SeloUnidade } from '@/components/painel/selo-unidade'
import { EmptyState } from '@/components/shell/empty-state'
import { TopBar } from '@/components/shell/top-bar'
import { requireStaff } from '@/lib/dal'
import { colunaLista } from '@/lib/lista-detalhe'
import { seloDaUnidade } from '@/lib/selo-unidade'
import { getDb } from '@/lib/server/db'
import { cn } from '@/lib/utils'

/** Coluna da lista de Unidades (slot `@lista`); com uma unidade aberta fica ao lado dela (≥ lg), marcada. */
export async function ColunaUnidades(props: { abertaId?: string }) {
  const s = await requireStaff()
  const { restaurante, unidades } = await carregarUnidadesPainel(getDb(), s.claims)
  const podeEditar = s.role !== 'atendente'
  const agora = new Date()
  return (
    <section aria-label="Lista de unidades" className={colunaLista(props.abertaId !== undefined)}>
      <TopBar title="Unidades" subtitle="Endereços, horários e exceções" className="lg:hidden" semFaixa />
      <div className="mx-auto flex w-full max-w-xl flex-col gap-3 px-4 py-6 lg:mx-0 lg:max-w-none lg:py-4">
        {unidades.length === 0 ? (
          <EmptyState
            icon={Store}
            title="Cadastre a primeira unidade"
            description="Endereço, horários e feriados de cada unidade são o que a IA usa para responder os clientes."
            action={podeEditar ? <NovaUnidade /> : undefined}
          />
        ) : (
          <>
            {podeEditar && <div className="flex justify-end"><NovaUnidade /></div>}
            <ul className="flex flex-col gap-2">
              {unidades.map((u) => {
                const aberta = u.id === props.abertaId
                return (
                  <li key={u.id}>
                    <Link
                      href={`/unidades/${u.id}`}
                      aria-current={aberta ? 'page' : undefined}
                      className={cn(
                        'flex min-h-16 items-center gap-3 rounded-lg border border-border bg-card p-4 transition-colors duration-150 [@media(hover:hover)]:hover:border-ring',
                        // fica no fundo de cartão (selo de tom sucesso AA) com a barra laranja
                        aberta && 'shadow-[inset_3px_0_0_var(--primary)]',
                      )}
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
                )
              })}
            </ul>
          </>
        )}
      </div>
    </section>
  )
}
