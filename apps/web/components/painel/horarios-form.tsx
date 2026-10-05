'use client'
import { Copy, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { DIAS_SEMANA } from '@atd/core/s1'
import { applyServerErrors, Field, FormError, SubmitButton, TimeInput, useZodForm } from '@/components/form'
import { Button } from '@/components/ui/button'
import { chamarAcao, type ActionResult } from '@/lib/action-result'
import { horariosSchema, type HorariosForm as Valores } from '@/lib/schemas/unidades'

const SEGUNDA_A_DOMINGO = [1, 2, 3, 4, 5, 6, 0] as const
const DIAS_UTEIS = [2, 3, 4, 5] as const
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/

export function HorariosForm(props: {
  unitId: string
  inicial: Valores
  acao: (valores: Valores) => Promise<ActionResult<null>>
  somenteLeitura?: boolean
}) {
  const form = useZodForm(horariosSchema, { defaultValues: props.inicial })
  const { errors, isSubmitting } = form.formState
  const semanal = form.watch('semanal')
  const definir = (dia: number, turnos: { abre: string; fecha: string }[]) =>
    form.setValue(`semanal.${dia}`, turnos, { shouldDirty: true, shouldValidate: form.formState.isSubmitted })
  const copiarSegunda = (dias: readonly number[]) => {
    const base = form.getValues('semanal.1').map((t) => ({ ...t }))
    for (const d of dias) definir(d, base.map((t) => ({ ...t })))
  }
  const onSubmit = form.handleSubmit(async (valores) => {
    const r = await chamarAcao(() => props.acao(valores))
    if (!r.ok) {
      applyServerErrors(form, r)
      return
    }
    toast.success('Horários salvos')
  })

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <FormError form={form} />
      {!props.somenteLeitura && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => copiarSegunda(DIAS_UTEIS)}>
            <Copy aria-hidden="true" className="size-4" /> Copiar segunda para dias úteis
          </Button>
          <Button type="button" variant="outline" onClick={() => copiarSegunda([2, 3, 4, 5, 6, 0])}>
            <Copy aria-hidden="true" className="size-4" /> Copiar segunda para todos os dias
          </Button>
        </div>
      )}
      {SEGUNDA_A_DOMINGO.map((dia) => {
        const turnos = semanal?.[dia] ?? []
        const erroDia = errors.semanal?.[dia] as { message?: string; root?: { message?: string } } | undefined
        const mensagemDia = erroDia?.message ?? erroDia?.root?.message
        return (
          <fieldset
            key={dia}
            aria-label={DIAS_SEMANA[dia]}
            disabled={props.somenteLeitura}
            className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
          >
            <legend className="px-1 font-semibold text-foreground">{DIAS_SEMANA[dia]}</legend>
            {turnos.length === 0 && <p className="text-sm text-muted-foreground">Fechada</p>}
            {turnos.map((t, i) => (
              <div key={i} className="flex flex-col gap-1">
                <div className="flex items-end gap-2">
                  <Field id={`semanal-${dia}-${i}-abre`} label="Abre" className="flex-1" error={errors.semanal?.[dia]?.[i]?.abre?.message}>
                    {(a) => <TimeInput {...a} {...form.register(`semanal.${dia}.${i}.abre`)} />}
                  </Field>
                  <Field id={`semanal-${dia}-${i}-fecha`} label="Fecha" className="flex-1" error={errors.semanal?.[dia]?.[i]?.fecha?.message}>
                    {(a) => <TimeInput {...a} {...form.register(`semanal.${dia}.${i}.fecha`)} />}
                  </Field>
                  {!props.somenteLeitura && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remover turno ${i + 1} de ${DIAS_SEMANA[dia]}`}
                      onClick={() => definir(dia, turnos.filter((_, j) => j !== i))}
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                    </Button>
                  )}
                </div>
                {HORA.test(t.abre) && HORA.test(t.fecha) && t.fecha < t.abre && (
                  <p className="text-sm text-muted-foreground">Termina no dia seguinte (madrugada).</p>
                )}
              </div>
            ))}
            {!props.somenteLeitura && turnos.length < 6 && (
              <Button type="button" variant="outline" className="self-start" onClick={() => definir(dia, [...turnos, { abre: '', fecha: '' }])}>
                <Plus aria-hidden="true" className="size-4" /> Adicionar turno
              </Button>
            )}
            {mensagemDia && <p aria-live="polite" className="text-sm font-medium text-destructive">{mensagemDia}</p>}
          </fieldset>
        )
      })}
      {!props.somenteLeitura && <SubmitButton pending={isSubmitting}>Salvar horários</SubmitButton>}
    </form>
  )
}
