import { Skeleton } from '@/components/ui/skeleton'

export default function Carregando() {
  return (
    <main aria-busy="true" className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
      <span className="sr-only">Carregando unidade…</span>
      <Skeleton className="h-11 w-full rounded-full" />
      {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
    </main>
  )
}
