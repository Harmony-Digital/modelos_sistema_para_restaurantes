import { MessagesSquare } from 'lucide-react'
import { EmptyState } from '@/components/shell/empty-state'
import { colunaDetalhe } from '@/lib/lista-detalhe'

/** Sem conversa aberta: ≥ lg o lado do detalhe ensina a escolher; < lg só a lista aparece. */
export default function ConversasPage() {
  return (
    <section aria-label="Conversa aberta" className={colunaDetalhe(false)}>
      <div className="m-auto w-full max-w-md p-8">
        <EmptyState
          icon={MessagesSquare}
          title="Escolha uma conversa"
          description="Clique numa conversa da lista para abrir aqui. No teclado: ↑ e ↓ percorrem a lista, Enter abre, A assume e Esc fecha."
        />
      </div>
    </section>
  )
}
