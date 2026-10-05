import { redirect } from 'next/navigation'
import { AuthCard } from '@/components/auth/auth-card'
import { createClient } from '@/lib/supabase/server'
import { definirSenha } from './actions'
import { DefinirSenhaForm } from './definir-senha-form'

export const dynamic = 'force-dynamic'

export default async function DefinirSenhaPage() {
  const { data } = await (await createClient()).auth.getClaims()
  if (!data?.claims?.sub) redirect('/login')
  return (
    <AuthCard title="Crie sua senha" description="Você foi convidado para o painel de atendimento. Defina uma senha para entrar.">
      <DefinirSenhaForm action={definirSenha} />
    </AuthCard>
  )
}
