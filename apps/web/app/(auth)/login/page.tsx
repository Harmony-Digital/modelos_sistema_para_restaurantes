import { marcaDoLogin } from '@atd/db'
import { AuthCard, type MarcaLogin } from '@/components/auth/auth-card'
import { urlPublicaLogo } from '@/lib/logo'
import { getDb } from '@/lib/server/db'
import { LoginForm } from './login-form'

/** Logo e nome só com exatamente um restaurante e com logo; qualquer falha deixa a tela de login como sempre foi. */
async function lerMarca(): Promise<MarcaLogin | null> {
  try {
    const m = await marcaDoLogin(getDb())
    const logo = urlPublicaLogo(m?.logoPath ?? null)
    return m && logo ? { nome: m.nome, logo } : null
  } catch {
    return null
  }
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const [{ erro }, marca] = await Promise.all([searchParams, lerMarca()])
  return (
    <AuthCard title="Entrar no painel" description="Use o e-mail do convite que você recebeu." marca={marca}>
      <LoginForm semAcesso={erro === 'sem-acesso'} />
    </AuthCard>
  )
}
