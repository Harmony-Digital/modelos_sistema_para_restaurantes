'use client'
import { useRef } from 'react'
import { Controller } from 'react-hook-form'
import { toast } from 'sonner'
import { applyServerErrors, Field, FormError, SubmitButton, SwitchField, TextInput, useZodForm } from '@/components/form'
import { chamarAcao, type ActionResult } from '@/lib/action-result'
import { categoriaSchema, type CategoriaForm as Valores } from '@/lib/schemas/cardapio'

export function CategoriaForm(props: {
  inicial: Valores
  acao: (valores: Valores) => Promise<ActionResult<unknown>>
  onSalvo?: () => void
  rotuloSalvar: string
}) {
  const form = useZodForm(categoriaSchema, { defaultValues: props.inicial })
  const { errors, isSubmitting } = form.formState
  // Guarda síncrona: duplo clique/Enter chega antes do re-render com pending e criaria categoria duplicada.
  const enviando = useRef(false)
  const onSubmit = form.handleSubmit(async () => {
    if (enviando.current) return
    enviando.current = true
    try {
      const r = await chamarAcao(() => props.acao(form.getValues()))
      if (!r.ok) {
        applyServerErrors(form, r)
        return
      }
      toast.success('Categoria salva')
      props.onSalvo?.()
    } finally {
      enviando.current = false
    }
  })
  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <FormError form={form} />
      <Field id="nome" label="Nome da categoria" error={errors.nome?.message} required>
        {(a) => <TextInput {...a} placeholder="Ex.: Carnes" {...form.register('nome')} />}
      </Field>
      <Field id="ordem" label="Posição" hint="Categorias com número menor aparecem primeiro." error={errors.ordem?.message} required>
        {(a) => <TextInput {...a} inputMode="numeric" {...form.register('ordem')} />}
      </Field>
      <Controller
        name="ativo"
        control={form.control}
        render={({ field }) => (
          <SwitchField id="ativo" label="Ativa" hint="Desativada, a IA deixa de oferecer os itens desta categoria." checked={field.value} onCheckedChange={field.onChange} />
        )}
      />
      <SubmitButton pending={isSubmitting}>{props.rotuloSalvar}</SubmitButton>
    </form>
  )
}
