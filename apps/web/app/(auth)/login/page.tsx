'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

// useSearchParams exige Suspense no build do Next 16
export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const [erro, setErro] = useState(params.get('erro') === 'sem-acesso' ? 'Este usuário não tem acesso ao painel.' : '')
  const [enviando, setEnviando] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setEnviando(true)
    setErro('')
    const form = new FormData(e.currentTarget)
    const { error } = await createClient().auth.signInWithPassword({
      email: String(form.get('email')),
      password: String(form.get('senha')),
    })
    setEnviando(false)
    if (error) return setErro('E-mail ou senha inválidos.')
    router.replace('/')
    router.refresh()
  }

  return (
    <main className="mx-auto mt-24 max-w-sm px-4">
      <h1 className="mb-6 text-xl font-semibold">Entrar no painel</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          E-mail
          <input name="email" type="email" required autoComplete="email" className="rounded border px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Senha
          <input name="senha" type="password" required autoComplete="current-password" className="rounded border px-3 py-2" />
        </label>
        {erro && <p role="alert" className="text-sm text-red-700">{erro}</p>}
        <button disabled={enviando} className="rounded bg-neutral-900 px-3 py-2 text-white disabled:opacity-50">
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  )
}
