'use client'
import { applyServerErrors, Field, FormError, PasswordInput, SubmitButton, useZodForm } from '@/components/form'
import type { ActionResult } from '@/lib/action-result'
import { definirSenhaSchema } from './schema'

export function DefinirSenhaForm(props: { action: (input: { senha: string; confirmacao: string }) => Promise<ActionResult> | void }) {
  const form = useZodForm(definirSenhaSchema, { defaultValues: { senha: '', confirmacao: '' } })
  const { errors, isSubmitting } = form.formState
  const onSubmit = form.handleSubmit(async (values) => {
    const result = await props.action(values)
    if (result && !result.ok) applyServerErrors(form, result)
  })
  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
      <FormError form={form} />
      <Field id="senha" label="Nova senha" hint="Pelo menos 12 caracteres, misturando letras e números" error={errors.senha?.message} required>
        {(a) => <PasswordInput {...a} autoComplete="new-password" placeholder="Ex.: Restaurante2026" {...form.register('senha')} />}
      </Field>
      <Field id="confirmacao" label="Confirme a senha" error={errors.confirmacao?.message} required>
        {(a) => <PasswordInput {...a} autoComplete="new-password" placeholder="Digite a mesma senha" {...form.register('confirmacao')} />}
      </Field>
      <SubmitButton pending={isSubmitting} className="w-full">Salvar senha</SubmitButton>
    </form>
  )
}
