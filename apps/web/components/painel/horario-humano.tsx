'use client'
import { Copy, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { DIAS_HORARIO_HUMANO } from '@atd/core/conversa'
import { applyServerErrors, Field, FormError, SubmitButton, TimeInput, useZodForm } from '@/components/form'
import { Button } from '@/components/ui/button'
import { chamarAcao, type ActionResult } from '@/lib/action-result'
import { horarioHumanoFormSchema, type HorarioHumanoForm as Valores } from '@/lib/schemas/atendimento'

const NOMES = { dom: 'Domingo', seg: 'Segunda', ter: 'Terça', qua: 'Quarta', qui: 'Quinta', sex: 'Sexta', sab: 'Sábado' } as const
const SEGUNDA_A_DOMINGO = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'] as const satisfies readonly (typeof DIAS_HORARIO_HUMANO)[number][]
const DIAS_UTEIS = ['ter', 'qua', 'qui', 'sex'] as const
const MAX_TURNOS = 4

/** Horário em que a equipe atende (fuso do restaurante). Vazio = a IA não promete horário de retorno. */
export function HorarioHumano(props: { inicial: Valores; acao: (v: Valores) => Promise<ActionResult<null>>; somenteLeitura?: boolean }) {
  const form = useZodForm(horarioHumanoFormSchema, { defaultValues: props.inicial })
  const { errors, isSubmitting } = form.formState
  const dias = form.watch('dias')
  const definir = (dia: (typeof SEGUNDA_A_DOMINGO)[number], turnos: { inicio: string; fim: string }[]) =>
    form.setValue(`dias.${dia}`, turnos, { shouldDirty: true, shouldValidate: form.formState.isSubmitted })
  const copiarSegunda = (alvo: readonly (typeof SEGUNDA_A_DOMINGO)[number][]) => {
    const base = (form.getValues('dias.seg') ?? []).map((t) => ({ ...t }))
    for (const d of alvo) definir(d, base.map((t) => ({ ...t })))
  }
  const onSubmit = form.handleSubmit(async () => {
    const r = await chamarAcao(() => props.acao(form.getValues()))
    if (!r.ok) {
      applyServerErrors(form, r)
      return
    }
    toast.success('Horário salvo')
  })
  const semNenhum = SEGUNDA_A_DOMINGO.every((d) => (dias?.[d] ?? []).length === 0)

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <FormError form={form} />
      {!props.somenteLeitura && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => copiarSegunda(DIAS_UTEIS)}>
            <Copy aria-hidden="true" className="size-4" /> Copiar segunda para dias úteis
          </Button>
          <Button type="button" variant="outline" onClick={() => copiarSegunda(['ter', 'qua', 'qui', 'sex', 'sab', 'dom'])}>
            <Copy aria-hidden="true" className="size-4" /> Copiar segunda para todos os dias
          </Button>
        </div>
      )}
      {SEGUNDA_A_DOMINGO.map((dia) => {
        const turnos = dias?.[dia] ?? []
        const erroDia = errors.dias?.[dia] as { message?: string; root?: { message?: string } } | undefined
        const mensagemDia = erroDia?.message ?? erroDia?.root?.message
        return (
          <fieldset key={dia} aria-label={NOMES[dia]} disabled={props.somenteLeitura} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
            <legend className="px-1 font-semibold text-foreground">{NOMES[dia]}</legend>
            {turnos.length === 0 && <p className="text-sm text-muted-foreground">Sem atendimento humano</p>}
            {turnos.map((_, i) => (
              <div key={i} className="flex items-end gap-2">
                <Field id={`dias-${dia}-${i}-inicio`} label="Começa" className="flex-1" error={errors.dias?.[dia]?.[i]?.inicio?.message}>
                  {(a) => <TimeInput {...a} {...form.register(`dias.${dia}.${i}.inicio`)} />}
                </Field>
                <Field id={`dias-${dia}-${i}-fim`} label="Termina" className="flex-1" error={errors.dias?.[dia]?.[i]?.fim?.message}>
                  {(a) => <TimeInput {...a} {...form.register(`dias.${dia}.${i}.fim`)} />}
                </Field>
                {!props.somenteLeitura && (
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remover turno ${i + 1} de ${NOMES[dia]}`} onClick={() => definir(dia, turnos.filter((_, j) => j !== i))}>
                    <Trash2 aria-hidden="true" className="size-4" />
                  </Button>
                )}
              </div>
            ))}
            {!props.somenteLeitura && turnos.length < MAX_TURNOS && (
              <Button type="button" variant="outline" className="self-start" onClick={() => definir(dia, [...turnos, { inicio: '', fim: '' }])}>
                <Plus aria-hidden="true" className="size-4" /> Adicionar turno
              </Button>
            )}
            {mensagemDia && <p aria-live="polite" className="text-sm font-medium text-destructive">{mensagemDia}</p>}
          </fieldset>
        )
      })}
      {semNenhum && (
        <p className="text-sm text-muted-foreground">
          Sem nenhum turno, a IA avisa que a equipe responde assim que possível, sem prometer um horário.
        </p>
      )}
      {!props.somenteLeitura && <SubmitButton pending={isSubmitting}>Salvar horário</SubmitButton>}
    </form>
  )
}
