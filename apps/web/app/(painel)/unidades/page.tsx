import { Store } from 'lucide-react'
import { EmptyState } from '@/components/shell/empty-state'
import { colunaDetalhe } from '@/lib/lista-detalhe'

/** Sem unidade aberta: ≥ lg o lado do detalhe ensina a escolher; < lg só a lista aparece. */
export default function UnidadesPage() {
  return (
    <section aria-label="Unidade aberta" className={colunaDetalhe(false)}>
      <div className="m-auto w-full max-w-md p-8">
        <EmptyState
          icon={Store}
          title="Escolha uma unidade"
          description="Clique numa unidade da lista para ver e editar dados, horários, exceções e espaços."
        />
      </div>
    </section>
  )
}
