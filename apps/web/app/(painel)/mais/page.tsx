import { LogOut } from 'lucide-react'
import { cookies } from 'next/headers'
import { Button } from '@/components/ui/button'
import { TopBar } from '@/components/shell/top-bar'
import { requireStaff } from '@/lib/dal'
import { parseTema, THEME_COOKIE } from '@/lib/theme'
import { setTheme, signOut } from '../actions'
import { ThemeForm } from './theme-form'

export const dynamic = 'force-dynamic'

const PAPEL = { dono: 'Dono', gerente: 'Gerente', atendente: 'Atendente' } as const

export default async function MaisPage() {
  const session = await requireStaff()
  const tema = parseTema((await cookies()).get(THEME_COOKIE)?.value)
  return (
    <>
      <TopBar title="Mais" subtitle={`Você entrou como ${PAPEL[session.role]}`} />
      <main className="mx-auto flex max-w-xl flex-col gap-8 px-4 py-6">
        <ThemeForm atual={tema} action={setTheme} />
        <section aria-labelledby="conta" className="flex flex-col gap-3">
          <h2 id="conta" className="text-sm font-medium text-foreground">Conta</h2>
          <form action={signOut}>
            <Button type="submit" variant="outline" className="w-full justify-start"><LogOut aria-hidden="true" className="size-4" /> Sair</Button>
          </form>
        </section>
      </main>
    </>
  )
}
