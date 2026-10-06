'use client'
import { useMemo, useRef } from 'react'
import { toast } from 'sonner'
import { applyServerErrors, Field, FormError, Select, SubmitButton, TextInput, TimeInput, useZodForm } from '@/components/form'
import { chamarAcao, type ActionResult } from '@/lib/action-result'
import { limiteDaPrevisao } from '@/lib/previsao'
import { avisoSchema, type AvisoForm as Valores } from '@/lib/schemas/avisos'

export function AvisoForm(props: {
  inicial: Valores
  hoje: string
  unidades: { id: string; nome: string }[]
  acao: (valores: Valores) => Promise<ActionResult<unknown>>
  onSalvo?: () => void
}) {
  const schema = useMemo(() => avisoSchema(props.hoje), [props.hoje])
  const form = useZodForm(schema, { defaultValues: props.inicial })
  const { errors, isSubmitting } = form.formState
  // Guarda síncrona: duplo clique/Enter chega antes do re-render com pending e criaria aviso duplicado.
  const enviando = useRef(false)
  const onSubmit = form.handleSubmit(async (valores) => {
    if (enviando.current) return
    enviando.current = true
    try {
      const r = await chamarAcao(() => props.acao(valores))
      if (!r.ok) {
        applyServerErrors(form, r)
        return
      }
      toast.success('Aviso anotado.')
      props.onSalvo?.()
    } finally {
      enviando.current = false
    }
  })
  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <FormError form={form} />
      <Field id="unitId" label="Unidade" error={errors.unitId?.message} required>
        {(a) => (
          <Select {...a} {...form.register('unitId')}>
            {props.unidades.length !== 1 && <option value="">Escolha a unidade</option>}
            {props.unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </Select>
        )}
      </Field>
      <Field id="data" label="Dia" hint="De hoje até 30 dias à frente" error={errors.data?.message} required>
        {(a) => <TextInput {...a} type="date" min={props.hoje} max={limiteDaPrevisao(props.hoje)} {...form.register('data')} />}
      </Field>
      <Field id="pessoas" label="Pessoas" error={errors.pessoas?.message} required>
        {(a) => <TextInput {...a} inputMode="numeric" autoComplete="off" placeholder="Ex.: 4" {...form.register('pessoas')} />}
      </Field>
      <Field id="horario" label="Horário aproximado" hint="Opcional. Deve estar dentro do funcionamento da unidade." error={errors.horario?.message}>
        {(a) => <TimeInput {...a} {...form.register('horario')} />}
      </Field>
      <Field id="nome" label="Nome" hint="Opcional. Só para a equipe identificar." error={errors.nome?.message}>
        {(a) => <TextInput {...a} autoComplete="off" placeholder="Ex.: Ana" {...form.register('nome')} />}
      </Field>
      <SubmitButton pending={isSubmitting}>Anotar aviso</SubmitButton>
    </form>
  )
}
