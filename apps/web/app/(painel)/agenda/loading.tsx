import { Skeleton } from '@/components/ui/skeleton'

export default function Carregando() {
  return (
    <main aria-busy="true" className="mx-auto flex max-w-xl flex-col gap-3 px-4 py-6">
      <span className="sr-only">Carregando a agenda…</span>
      <Skeleton className="h-11 w-full rounded-md" />
      <Skeleton className="h-6 w-2/3" />
      {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
    </main>
  )
}
