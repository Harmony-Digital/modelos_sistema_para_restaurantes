import { MessageSquareOff } from 'lucide-react'
import Link from 'next/link'
import { EmptyState } from '@/components/shell/empty-state'
import { colunaDetalhe } from '@/lib/lista-detalhe'

/** Conversa inexistente ou fora das unidades da pessoa: a lista segue ao lado (≥ lg). */
export default function ConversaNaoEncontrada() {
  return (
    <section aria-label="Conversa aberta" className={colunaDetalhe(true)}>
      <div className="m-auto w-full max-w-md p-8">
        <EmptyState
          icon={MessageSquareOff}
          title="Conversa não encontrada"
          description="Ela pode ter sido encerrada ou você não tem acesso a ela."
          action={<Link href="/conversas" className="inline-flex min-h-11 items-center text-sm font-medium text-link">Ver conversas</Link>}
        />
      </div>
    </section>
  )
}
