'use client'
import { useMemo, useRef } from 'react'
import { toast } from 'sonner'
import { applyServerErrors, Field, FormError, PhoneInput, Select, SubmitButton, TextInput, TimeInput, useZodForm } from '@/components/form'
import { chamarAcao, type ActionResult } from '@/lib/action-result'
import { limiteDaPrevisao } from '@/lib/previsao'
import { reservaSchema, type ReservaForm as Valores } from '@/lib/schemas/avisos'

/** Reserva anotada pela equipe (cliente reservou por telefone ou no balcão): nome e horário obrigatórios; contato opcional. */
export function ReservaForm(props: {
  inicial: Valores
  hoje: string
  unidades: { id: string; nome: string }[]
  acao: (valores: Valores) => Promise<ActionResult<unknown>>
  onSalvo?: () => void
}) {
  const schema = useMemo(() => reservaSchema(props.hoje), [props.hoje])
  const form = useZodForm(schema, { defaultValues: props.inicial })
  const { errors, isSubmitting } = form.formState
  // Guarda síncrona: duplo clique/Enter chega antes do re-render com pending e criaria reserva duplicada.
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
      toast.success('Reserva anotada.')
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
      <div className="grid grid-cols-2 gap-4">
        <Field id="horario" label="Horário" hint="Dentro do funcionamento" error={errors.horario?.message} required>
          {(a) => <TimeInput {...a} placeholder="Ex.: 20:00" {...form.register('horario')} />}
        </Field>
        <Field id="pessoas" label="Pessoas" error={errors.pessoas?.message} required>
          {(a) => <TextInput {...a} inputMode="numeric" autoComplete="off" placeholder="Ex.: 4" {...form.register('pessoas')} />}
        </Field>
      </div>
      <Field id="nome" label="Nome" hint="Em nome de quem fica a reserva" error={errors.nome?.message} required>
        {(a) => <TextInput {...a} autoComplete="off" placeholder="Ex.: Ana" {...form.register('nome')} />}
      </Field>
      <Field id="contato" label="Telefone para contato" hint="Opcional. Fica cifrado; a equipe vê pelo “Ver contato”." error={errors.contato?.message}>
        {(a) => <PhoneInput {...a} autoComplete="off" {...form.register('contato')} />}
      </Field>
      <SubmitButton pending={isSubmitting}>Salvar reserva</SubmitButton>
    </form>
  )
}
