'use client'
import { RotateCcw } from 'lucide-react'
import { useRef } from 'react'
import { toast } from 'sonner'
import { applyServerErrors, Field, FormError, SubmitButton, Textarea, useZodForm } from '@/components/form'
import { Button } from '@/components/ui/button'
import { chamarAcao, type ActionResult } from '@/lib/action-result'
import { MAX_REGRAS_RESERVA, regrasReservaSchema, type RegrasReservaForm as Valores } from '@/lib/schemas/restaurante'
import { cn } from '@/lib/utils'

/**
 * Regras enviadas ao cliente logo depois que a reserva é confirmada (Ajustes; dono e gerente). "Restaurar padrão" só
 * troca o texto do campo: grava ao salvar.
 */
export function RegrasReservaForm(props: { inicial: string; padrao: string; acao: (v: Valores) => Promise<ActionResult<null>> }) {
  const form = useZodForm(regrasReservaSchema, { defaultValues: { texto: props.inicial } })
  const { errors, isSubmitting } = form.formState
  const texto = form.watch('texto') ?? ''
  // Guarda síncrona contra duplo envio (clique/Enter antes do re-render com pending).
  const enviando = useRef(false)
  const onSubmit = form.handleSubmit(async (v) => {
    if (enviando.current) return
    enviando.current = true
    try {
      const r = await chamarAcao(() => props.acao(v))
      if (!r.ok) {
        applyServerErrors(form, r)
        return
      }
      toast.success('Regras da reserva salvas.')
    } finally {
      enviando.current = false
    }
  })
  const passou = texto.length > MAX_REGRAS_RESERVA
  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-3">
      <FormError form={form} />
      <Field
        id="regras-reserva"
        label="Regras enviadas depois da reserva"
        hint="A IA manda este texto logo depois do resumo da reserva confirmada."
        error={errors.texto?.message}
        required
      >
        {(a) => <Textarea {...a} rows={5} {...form.register('texto')} />}
      </Field>
      <p aria-live="polite" className={cn('-mt-1 text-right font-mono text-xs tabular-nums', passou ? 'text-destructive' : 'text-muted-foreground')}>
        {texto.length}/{MAX_REGRAS_RESERVA}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton pending={isSubmitting}>Salvar regras</SubmitButton>
        <Button
          type="button"
          variant="outline"
          disabled={texto === props.padrao}
          onClick={() => form.setValue('texto', props.padrao, { shouldDirty: true, shouldValidate: true })}
        >
          <RotateCcw aria-hidden="true" className="size-4" /> Restaurar padrão
        </Button>
      </div>
    </form>
  )
}
