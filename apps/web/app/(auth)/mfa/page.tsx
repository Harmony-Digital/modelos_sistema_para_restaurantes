'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Estado = { tipo: 'carregando' } | { tipo: 'cadastrar'; factorId: string; qr: string; secret: string } | { tipo: 'verificar'; factorId: string }

export default function MfaPage() {
  const router = useRouter()
  const [estado, setEstado] = useState<Estado>({ tipo: 'carregando' })
  const [codigo, setCodigo] = useState('')
  const [erro, setErro] = useState('')

  useEffect(() => {
    const supabase = createClient()
    void (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors()
      if (error) return setErro('Não foi possível carregar a verificação em duas etapas.')
      const verificado = data.totp.find((f) => f.status === 'verified')
      if (verificado) return setEstado({ tipo: 'verificar', factorId: verificado.id })
      const enroll = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `painel-${Date.now()}` })
      if (enroll.error) return setErro('Não foi possível iniciar o cadastro do autenticador.')
      setEstado({ tipo: 'cadastrar', factorId: enroll.data.id, qr: enroll.data.totp.qr_code, secret: enroll.data.totp.secret })
    })()
  }, [])

  async function verificar(e: React.FormEvent) {
    e.preventDefault()
    if (estado.tipo === 'carregando') return
    setErro('')
    const supabase = createClient()
    const challenge = await supabase.auth.mfa.challenge({ factorId: estado.factorId })
    if (challenge.error) return setErro('Falha ao gerar o desafio. Tente de novo.')
    const verify = await supabase.auth.mfa.verify({ factorId: estado.factorId, challengeId: challenge.data.id, code: codigo })
    if (verify.error) return setErro('Código inválido ou expirado.')
    router.replace('/')
    router.refresh()
  }

  return (
    <main className="mx-auto mt-24 max-w-sm px-4">
      <h1 className="mb-2 text-xl font-semibold">Verificação em duas etapas</h1>
      {estado.tipo === 'cadastrar' && (
        <div className="mb-4 text-sm">
          <p className="mb-2">Escaneie com seu app autenticador (Google Authenticator, 1Password, Authy…):</p>
          {/* qr_code é um data URL SVG gerado pelo Supabase */}
          <img src={estado.qr} alt="QR code do autenticador" width={200} height={200} />
          <p className="mt-2 break-all text-neutral-600">Ou digite a chave: {estado.secret}</p>
        </div>
      )}
      {estado.tipo !== 'carregando' && (
        <form onSubmit={verificar} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Código de 6 dígitos
            <input value={codigo} onChange={(e) => setCodigo(e.target.value.trim())} inputMode="numeric" pattern="\d{6}" required autoComplete="one-time-code" className="rounded border px-3 py-2" />
          </label>
          <button className="rounded bg-neutral-900 px-3 py-2 text-white">Confirmar</button>
        </form>
      )}
      {erro && <p role="alert" className="mt-3 text-sm text-red-700">{erro}</p>}
    </main>
  )
}
