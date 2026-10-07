import { Store } from 'lucide-react'
import Link from 'next/link'
import { EmptyState } from '@/components/shell/empty-state'
import { colunaDetalhe } from '@/lib/lista-detalhe'

/** Unidade inexistente ou fora das unidades da pessoa: a lista segue ao lado (≥ lg). */
export default function UnidadeNaoEncontrada() {
  return (
    <section aria-label="Unidade aberta" className={colunaDetalhe(true)}>
      <div className="m-auto w-full max-w-md p-8">
        <EmptyState
          icon={Store}
          title="Unidade não encontrada"
          description="Ela pode ter sido removida ou você não tem acesso a ela."
          action={<Link href="/unidades" className="inline-flex min-h-11 items-center text-sm font-medium text-link">Ver unidades</Link>}
        />
      </div>
    </section>
  )
}
