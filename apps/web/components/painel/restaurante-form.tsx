'use client'
import { useRef } from 'react'
import { toast } from 'sonner'
import { applyServerErrors, Field, FormError, Select, SubmitButton, TextInput, useZodForm } from '@/components/form'
import { chamarAcao, type ActionResult } from '@/lib/action-result'
import { restauranteSchema, type RestauranteForm as Valores } from '@/lib/schemas/restaurante'

export function RestauranteForm(props: { inicial: Valores; acao: (v: Valores) => Promise<ActionResult<null>>; somenteLeitura?: boolean }) {
  const form = useZodForm(restauranteSchema, { defaultValues: props.inicial })
  const { errors, isSubmitting } = form.formState
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
      toast.success('Restaurante salvo')
    } finally {
      enviando.current = false
    }
  })
  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <FormError form={form} />
      <fieldset disabled={props.somenteLeitura} className="flex flex-col gap-4">
        <Field id="nome" label="Nome do restaurante" hint="Aparece no aviso de privacidade e no simulador" error={errors.nome?.message} required>
          {(a) => <TextInput {...a} placeholder="Ex.: Casa Harmonia" {...form.register('nome')} />}
        </Field>
        <Field id="politicaFeriado" label="Nos feriados nacionais" hint="Datas com exceção cadastrada seguem a exceção" error={errors.politicaFeriado?.message} required>
          {(a) => (
            <Select {...a} {...form.register('politicaFeriado')}>
              <option value="como_domingo">Abre como no domingo</option>
              <option value="normal">Abre como num dia comum</option>
              <option value="fechado">Fica fechado</option>
            </Select>
          )}
        </Field>
        <Field id="politicaUrl" label="Link da política de privacidade" hint="Enviado no primeiro contato do cliente (LGPD)" error={errors.politicaUrl?.message}>
          {(a) => <TextInput {...a} type="url" inputMode="url" placeholder="Ex.: https://seurestaurante.com.br/privacidade" {...form.register('politicaUrl')} />}
        </Field>
      </fieldset>
      {!props.somenteLeitura && <SubmitButton pending={isSubmitting}>Salvar restaurante</SubmitButton>}
    </form>
  )
}
