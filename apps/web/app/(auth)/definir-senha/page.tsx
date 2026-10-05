import { redirect } from 'next/navigation'
import { AuthCard } from '@/components/auth/auth-card'
import { isInviteSession, podeDefinirSenha } from '@/lib/auth-confirm'
import { createClient } from '@/lib/supabase/server'
import { definirSenha } from './actions'
import { DefinirSenhaForm } from './definir-senha-form'

export const dynamic = 'force-dynamic'

export default async function DefinirSenhaPage() {
  const supabase = await createClient()
  let claims: { amr?: unknown; sub?: string } | null | undefined
  let aal: { currentLevel: string | null; nextLevel: string | null } | null = null
  try {
    claims = (await supabase.auth.getClaims()).data?.claims
    if (claims?.sub && isInviteSession(claims)) {
      const r = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      aal = r.error ? null : r.data
    }
  } catch {
    claims = null
  }
  if (!claims?.sub) redirect('/login')
  // Só a sessão do link de convite define senha aqui; quem entrou por senha vai ao painel (e ao MFA).
  if (!isInviteSession(claims)) redirect('/')
  if (!aal) redirect('/login')
  // Já tem MFA verificado mas a sessão é aal1: precisa passar pelo MFA antes.
  if (!podeDefinirSenha(claims, aal)) redirect('/mfa')
  return (
    <AuthCard title="Crie sua senha" description="Você foi convidado para o painel de atendimento. Defina uma senha para entrar.">
      <DefinirSenhaForm action={definirSenha} />
    </AuthCard>
  )
}
