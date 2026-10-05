import { requireStaff } from '@/lib/dal'
import { signOut } from './actions'

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const session = await requireStaff()
  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-6 flex items-center justify-between">
        <span className="font-semibold">Atendimento IA</span>
        <form action={signOut} className="flex items-center gap-3 text-sm">
          <span className="text-neutral-600">{session.role}</span>
          <button className="underline">Sair</button>
        </form>
      </header>
      {children}
    </div>
  )
}
