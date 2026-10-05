import { AuthCard } from '@/components/auth/auth-card'
import { LoginForm } from './login-form'

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams
  return (
    <AuthCard title="Entrar no painel" description="Use o e-mail do convite que você recebeu.">
      <LoginForm semAcesso={erro === 'sem-acesso'} />
    </AuthCard>
  )
}
