'use client'
import { Plus, Trash2 } from 'lucide-react'
import { Controller } from 'react-hook-form'
import { toast } from 'sonner'
import { applyServerErrors, DateInput, Field, FormError, SubmitButton, SwitchField, TextInput, TimeInput, useZodForm } from '@/components/form'
import { Button } from '@/components/ui/button'
import { chamarAcao, type ActionResult } from '@/lib/action-result'
import { excecaoSchema, type ExcecaoForm as Valores } from '@/lib/schemas/unidades'

export function ExcecaoForm(props: {
  inicial: Valores
  acao: (valores: Valores) => Promise<ActionResult<null>>
  onSalvo?: () => void
  /** Editando uma exceção existente: trocar a data criaria outra e manteria a antiga. */
  dataFixa?: boolean
}) {
  const form = useZodForm(excecaoSchema, { defaultValues: props.inicial })
  const { errors, isSubmitting } = form.formState
  const fechado = form.watch('fechado')
  const turnos = form.watch('turnos') ?? []
  const definir = (t: { abre: string; fecha: string }[]) => form.setValue('turnos', t, { shouldDirty: true, shouldValidate: form.formState.isSubmitted })
  // envia os valores digitados (data em dd/mm/aaaa): a action valida e converte de novo
  const onSubmit = form.handleSubmit(async () => {
    const r = await chamarAcao(() => props.acao(form.getValues()))
    if (!r.ok) {
      applyServerErrors(form, r)
      return
    }
    toast.success('Exceção salva')
    props.onSalvo?.()
  })
  const erroTurnos = errors.turnos as { message?: string; root?: { message?: string } } | undefined

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <FormError form={form} />
      <Field id="data" label="Data" hint={props.dataFixa ? 'Para mudar a data, apague e crie outra.' : 'dd/mm/aaaa'} error={errors.data?.message} required>
        {(a) => <DateInput {...a} readOnly={props.dataFixa} {...form.register('data')} />}
      </Field>
      <Controller
        name="fechado"
        control={form.control}
        render={({ field }) => <SwitchField id="fechado" label="Fechado o dia todo" checked={field.value} onCheckedChange={field.onChange} />}
      />
      {!fechado && (
        <fieldset className="flex flex-col gap-3" aria-label="Turnos do dia">
          {turnos.map((_, i) => (
            <div key={i} className="flex items-end gap-2">
              <Field id={`turnos-${i}-abre`} label="Abre" className="flex-1" error={errors.turnos?.[i]?.abre?.message}>
                {(a) => <TimeInput {...a} {...form.register(`turnos.${i}.abre`)} />}
              </Field>
              <Field id={`turnos-${i}-fecha`} label="Fecha" className="flex-1" error={errors.turnos?.[i]?.fecha?.message}>
                {(a) => <TimeInput {...a} {...form.register(`turnos.${i}.fecha`)} />}
              </Field>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remover turno ${i + 1}`} onClick={() => definir(turnos.filter((__, j) => j !== i))}>
                <Trash2 aria-hidden="true" className="size-4" />
              </Button>
            </div>
          ))}
          {turnos.length < 6 && (
            <Button type="button" variant="outline" className="self-start" onClick={() => definir([...turnos, { abre: '', fecha: '' }])}>
              <Plus aria-hidden="true" className="size-4" /> Adicionar turno
            </Button>
          )}
          {(erroTurnos?.message ?? erroTurnos?.root?.message) && (
            <p aria-live="polite" className="text-sm font-medium text-destructive">{erroTurnos?.message ?? erroTurnos?.root?.message}</p>
          )}
        </fieldset>
      )}
      <Field id="motivo" label="Motivo" hint="Opcional. Só para a equipe; a IA não repete o motivo." error={errors.motivo?.message}>
        {(a) => <TextInput {...a} placeholder="Ex.: Inventário" {...form.register('motivo')} />}
      </Field>
      <SubmitButton pending={isSubmitting}>Salvar exceção</SubmitButton>
    </form>
  )
}
