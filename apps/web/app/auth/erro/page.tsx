import { AuthCard } from '@/components/auth/auth-card'

export default function AuthErroPage() {
  return (
    <AuthCard title="Link inválido ou expirado" description="Links de convite valem por 1 hora e só podem ser usados uma vez.">
      <p className="text-sm text-foreground">Peça ao dono do restaurante um novo convite e abra o link mais recente do seu e-mail.</p>
      <a href="/login" className="mt-6 inline-flex min-h-11 items-center text-sm font-semibold text-link underline underline-offset-4">
        Ir para o login
      </a>
    </AuthCard>
  )
}
