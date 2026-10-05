'use client'
import { Controller } from 'react-hook-form'
import { toast } from 'sonner'
import {
  applyServerErrors, Field, FormError, Select, SubmitButton, SwitchField, TagInput, Textarea, TextInput, useZodForm,
} from '@/components/form'
import type { ActionResult } from '@/lib/action-result'
import { fatoSchema, type FatoForm as Valores } from '@/lib/schemas/respostas'

export function FatoForm(props: {
  inicial: Valores
  unidades: { id: string; nome: string }[]
  acao: (valores: Valores) => Promise<ActionResult<unknown>>
  onSalvo?: () => void
  rotuloSalvar: string
}) {
  const form = useZodForm(fatoSchema, { defaultValues: props.inicial })
  const { errors, isSubmitting } = form.formState
  const onSubmit = form.handleSubmit(async (valores) => {
    const r = await props.acao(valores)
    if (!r.ok) {
      applyServerErrors(form, r)
      return
    }
    toast.success('Informação salva. A IA já passa a responder com ela.')
    props.onSalvo?.()
  })
  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <FormError form={form} />
      <Field id="tema" label="Assunto" hint="Uma ou duas palavras, como o cliente pergunta" error={errors.tema?.message} required>
        {(a) => <TextInput {...a} placeholder="Ex.: Estacionamento" {...form.register('tema')} />}
      </Field>
      <Field id="texto" label="Resposta" hint="Exatamente o que a IA vai enviar ao cliente" error={errors.texto?.message} required>
        {(a) => <Textarea {...a} rows={4} placeholder="Ex.: Temos estacionamento gratuito para clientes." {...form.register('texto')} />}
      </Field>
      <Controller
        name="exemplos"
        control={form.control}
        render={({ field }) => (
          <Field id="exemplos" label="Jeitos de perguntar" hint="Opcional. Ajuda a IA a reconhecer o assunto. Tecle Enter a cada um." error={errors.exemplos?.message}>
            {(a) => <TagInput {...a} value={field.value} onChange={field.onChange} onBlur={field.onBlur} max={10} listLabel="Exemplos" placeholder="Ex.: tem vaga?" />}
          </Field>
        )}
      />
      <Field id="unitId" label="Vale para" error={errors.unitId?.message}>
        {(a) => (
          <Select {...a} {...form.register('unitId')}>
            <option value="">Todas as unidades</option>
            {props.unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </Select>
        )}
      </Field>
      <Controller
        name="ativo"
        control={form.control}
        render={({ field }) => (
          <SwitchField id="ativo" label="Ativa" hint="Desativada, a IA deixa de usar esta resposta." checked={field.value} onCheckedChange={field.onChange} />
        )}
      />
      <SubmitButton pending={isSubmitting}>{props.rotuloSalvar}</SubmitButton>
    </form>
  )
}
