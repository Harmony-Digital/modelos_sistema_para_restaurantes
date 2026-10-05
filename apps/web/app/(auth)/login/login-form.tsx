'use client'
import { AlertTriangle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import { Field, FormError, PasswordInput, SubmitButton, TextInput, useZodForm } from '@/components/form'
import { createClient } from '@/lib/supabase/client'
import { email, senhaLogin } from '@/lib/validation'

const schema = z.object({ email, senha: senhaLogin })

export function LoginForm({ semAcesso }: { semAcesso: boolean }) {
  const router = useRouter()
  const form = useZodForm(schema, { defaultValues: { email: '', senha: '' } })
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async ({ email, senha }) => {
    const { error } = await createClient().auth.signInWithPassword({ email, password: senha })
    if (error && error.code !== 'invalid_credentials') {
      form.setError('root.server', { type: 'server', message: 'Não foi possível entrar agora. Tente de novo em instantes.' })
      return
    }
    if (error) {
      form.setError('senha', { type: 'server', message: 'E-mail ou senha incorretos. Confira e tente de novo.' }, { shouldFocus: true })
      return
    }
    router.replace('/')
    router.refresh()
  })

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
      {semAcesso && (
        <p role="alert" className="flex items-start gap-2 rounded-md border border-warning p-3 text-sm text-warning">
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          Este usuário não tem acesso ao painel. Fale com o dono do restaurante.
        </p>
      )}
      <FormError form={form} />
      <Field id="email" label="E-mail" error={errors.email?.message} required>
        {(a) => <TextInput {...a} type="email" autoComplete="email" placeholder="Ex.: gerente@restaurante.com.br" {...form.register('email')} />}
      </Field>
      <Field id="senha" label="Senha" error={errors.senha?.message} required>
        {(a) => <PasswordInput {...a} autoComplete="current-password" placeholder="Sua senha" {...form.register('senha')} />}
      </Field>
      <SubmitButton pending={isSubmitting} pendingText="Entrando…" className="w-full">Entrar</SubmitButton>
    </form>
  )
}
