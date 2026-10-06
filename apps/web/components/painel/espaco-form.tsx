'use client'
import { Controller } from 'react-hook-form'
import { toast } from 'sonner'
import { applyServerErrors, Field, FormError, SubmitButton, SwitchField, Textarea, TextInput, useZodForm } from '@/components/form'
import { chamarAcao, type ActionResult } from '@/lib/action-result'
import { espacoSchema, type EspacoForm as Valores } from '@/lib/schemas/espacos'

export const ESPACO_VAZIO: Valores = { nome: '', capacidadeMin: '', capacidadeMax: '', descricao: '', condicoes: '', ativo: true }

export function EspacoForm(props: {
  inicial: Valores
  acao: (valores: Valores) => Promise<ActionResult<{ id: string }>>
  onSalvo?: () => void
}) {
  const form = useZodForm(espacoSchema, { defaultValues: props.inicial })
  const { errors, isSubmitting } = form.formState
  const onSubmit = form.handleSubmit(async () => {
    const r = await chamarAcao(() => props.acao(form.getValues()))
    if (!r.ok) {
      applyServerErrors(form, r)
      return
    }
    toast.success('Espaço salvo')
    props.onSalvo?.()
  })
  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <FormError form={form} />
      <Field id="nome" label="Nome do espaço" error={errors.nome?.message} required>
        {(a) => <TextInput {...a} placeholder='Ex.: Salão' autoComplete="off" {...form.register('nome')} />}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field id="capacidadeMin" label="Mínimo de pessoas" error={errors.capacidadeMin?.message} required>
          {(a) => <TextInput {...a} inputMode="numeric" autoComplete="off" placeholder="Ex.: 20" {...form.register('capacidadeMin')} />}
        </Field>
        <Field id="capacidadeMax" label="Máximo de pessoas" error={errors.capacidadeMax?.message} required>
          {(a) => <TextInput {...a} inputMode="numeric" autoComplete="off" placeholder="Ex.: 80" {...form.register('capacidadeMax')} />}
        </Field>
      </div>
      <Field id="descricao" label="Descrição" hint="Opcional. A IA envia ao cliente na lista de espaços, como está escrito aqui." error={errors.descricao?.message}>
        {(a) => <Textarea {...a} rows={3} {...form.register('descricao')} />}
      </Field>
      <Field id="condicoes" label="Condições" hint="A IA envia ao cliente na lista de espaços; não coloque dados internos." error={errors.condicoes?.message}>
        {(a) => <Textarea {...a} rows={3} {...form.register('condicoes')} />}
      </Field>
      <Controller
        name="ativo"
        control={form.control}
        render={({ field }) => <SwitchField id="ativo" label="Espaço ativo" hint="Inativo não aparece para a IA." checked={field.value} onCheckedChange={field.onChange} />}
      />
      <SubmitButton pending={isSubmitting}>Salvar espaço</SubmitButton>
    </form>
  )
}
