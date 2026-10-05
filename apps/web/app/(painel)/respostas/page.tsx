import { MessageSquareText } from 'lucide-react'
import { EmptyState } from '@/components/shell/empty-state'
import { TopBar } from '@/components/shell/top-bar'
import { requireStaff } from '@/lib/dal'

export const dynamic = 'force-dynamic'

export default async function RespostasPage() {
  await requireStaff()
  return (
    <>
      <TopBar title="Respostas" subtitle="O que a IA sabe e o que falta" />
      <main className="mx-auto max-w-xl px-4 py-6">
        <EmptyState
          icon={MessageSquareText}
          title="Cadastro de respostas em preparação"
          description="Aqui você vai ver as perguntas que a IA ainda não sabe responder e cadastrar as respostas."
        />
      </main>
    </>
  )
}
