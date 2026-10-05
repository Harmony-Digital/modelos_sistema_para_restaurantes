import { redirect } from 'next/navigation'
import { AuthCard } from '@/components/auth/auth-card'
import { isInviteSession } from '@/lib/auth-confirm'
import { createClient } from '@/lib/supabase/server'
import { definirSenha } from './actions'
import { DefinirSenhaForm } from './definir-senha-form'

export const dynamic = 'force-dynamic'

export default async function DefinirSenhaPage() {
  let claims: { amr?: unknown; sub?: string } | null | undefined
  try {
    claims = (await (await createClient()).auth.getClaims()).data?.claims
  } catch {
    claims = null
  }
  if (!claims?.sub) redirect('/login')
  // Só a sessão do link de convite define senha aqui; quem entrou por senha vai ao painel (e ao MFA).
  if (!isInviteSession(claims)) redirect('/')
  return (
    <AuthCard title="Crie sua senha" description="Você foi convidado para o painel de atendimento. Defina uma senha para entrar.">
      <DefinirSenhaForm action={definirSenha} />
    </AuthCard>
  )
}
