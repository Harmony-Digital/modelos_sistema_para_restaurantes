'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { AuthCard } from '@/components/auth/auth-card'
import { Field, SubmitButton, TextInput } from '@/components/form'
import { createClient } from '@/lib/supabase/client'

type Estado = { tipo: 'carregando' } | { tipo: 'cadastrar'; factorId: string; qr: string; secret: string } | { tipo: 'verificar'; factorId: string }

export default function MfaPage() {
  const router = useRouter()
  const [estado, setEstado] = useState<Estado>({ tipo: 'carregando' })
  const [codigo, setCodigo] = useState('')
  const [erro, setErro] = useState('')
  const [erroCodigo, setErroCodigo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const codigoRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const supabase = createClient()
    void (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors()
      if (error) return setErro('Não foi possível carregar a verificação em duas etapas.')
      const verificado = data.totp.find((f) => f.status === 'verified')
      if (verificado) return setEstado({ tipo: 'verificar', factorId: verificado.id })
      // Fator TOTP não verificado de tentativa anterior: remove para não acumular até o limite.
      for (const f of data.all.filter((x) => x.factor_type === 'totp' && x.status === 'unverified')) {
        await supabase.auth.mfa.unenroll({ factorId: f.id })
      }
      const enroll = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `painel-${Date.now()}` })
      if (enroll.error) return setErro('Não foi possível iniciar o cadastro do autenticador.')
      setEstado({ tipo: 'cadastrar', factorId: enroll.data.id, qr: enroll.data.totp.qr_code, secret: enroll.data.totp.secret })
    })()
  }, [])

  async function verificar(e: React.FormEvent) {
    e.preventDefault()
    if (estado.tipo === 'carregando' || enviando) return
    setErro('')
    setErroCodigo('')
    setEnviando(true)
    const supabase = createClient()
    const challenge = await supabase.auth.mfa.challenge({ factorId: estado.factorId })
    if (challenge.error) {
      setEnviando(false)
      return setErro('Falha ao gerar o desafio. Tente de novo.')
    }
    const verify = await supabase.auth.mfa.verify({ factorId: estado.factorId, challengeId: challenge.data.id, code: codigo })
    if (verify.error) {
      setEnviando(false)
      setErroCodigo('Código inválido ou expirado. Confira o código atual no app.')
      codigoRef.current?.focus()
      return
    }
    router.replace('/')
    router.refresh()
  }

  return (
    <AuthCard
      title="Verificação em duas etapas"
      description="Para proteger os dados do restaurante, donos e gerentes usam um app autenticador."
    >
      {estado.tipo === 'cadastrar' && (
        <div className="mb-6 text-sm">
          <p className="mb-3 text-foreground">Escaneie com seu app autenticador (Google Authenticator, 1Password, Authy…):</p>
          <div className="mx-auto w-fit rounded-md bg-white p-3">
            {/* qr_code é um data URL SVG gerado pelo Supabase */}
            <img src={estado.qr} alt="QR code do autenticador" width={200} height={200} />
          </div>
          <p className="mt-3 text-muted-foreground">Ou digite a chave:</p>
          <p className="break-all font-mono text-foreground">{estado.secret}</p>
        </div>
      )}
      {estado.tipo !== 'carregando' && (
        <form onSubmit={verificar} noValidate className="flex flex-col gap-5">
          <Field id="codigo" label="Código de 6 dígitos" hint="Abra o app autenticador e digite o código atual" error={erroCodigo || undefined} required>
            {(a) => (
              <TextInput
                {...a}
                ref={codigoRef}
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
              />
            )}
          </Field>
          <SubmitButton pending={enviando} pendingText="Verificando…" className="w-full">Confirmar</SubmitButton>
        </form>
      )}
      {erro && <p role="alert" className="mt-4 text-sm font-medium text-destructive">{erro}</p>}
    </AuthCard>
  )
}
