import { Skeleton } from '@/components/ui/skeleton'
import { colunaDetalhe } from '@/lib/lista-detalhe'

export default function Carregando() {
  return (
    <section aria-busy="true" aria-label="Carregando unidade" className={colunaDetalhe(true)}>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-6 lg:max-w-3xl lg:px-6">
        <span className="sr-only">Carregando unidade…</span>
        <Skeleton className="h-11 w-full rounded-md" />
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
      </div>
    </section>
  )
}
