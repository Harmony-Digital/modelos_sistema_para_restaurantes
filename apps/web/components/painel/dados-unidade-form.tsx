'use client'
import { CheckCircle2 } from 'lucide-react'
import { Controller } from 'react-hook-form'
import { toast } from 'sonner'
import { ehLinkGoogleMaps } from '@atd/core/s1'
import {
  applyServerErrors, ErrorSummary, Field, FormError, PhoneInput, SubmitButton, SwitchField, TagInput, TextInput, useErrorSummary,
  useZodForm,
} from '@/components/form'
import type { ActionResult } from '@/lib/action-result'
import { dadosUnidadeSchema, type DadosUnidadeForm as Valores } from '@/lib/schemas/unidades'

export const UNIDADE_VAZIA: Valores = {
  nome: '', endereco: '', bairro: '', cidade: '', uf: '', cep: '', telefone: '', apelidos: [], mapsUrl: '', ativo: true,
}

const ROTULOS = {
  nome: 'Nome da unidade', endereco: 'Endereço', bairro: 'Bairro', cidade: 'Cidade', uf: 'UF', cep: 'CEP',
  telefone: 'Telefone', apelidos: 'Apelidos', mapsUrl: 'Link do Google Maps',
}

export function DadosUnidadeForm(props: {
  inicial: Valores
  acao: (valores: Valores) => Promise<ActionResult<{ id: string; aviso?: string }>>
  onSalvo?: (id: string) => void
  somenteLeitura?: boolean
}) {
  const form = useZodForm(dadosUnidadeSchema, { defaultValues: props.inicial })
  const { errors, isSubmitting } = form.formState
  const resumo = useErrorSummary(form, ROTULOS)
  const maps = form.watch('mapsUrl') ?? ''
  const mapsOk = maps !== '' && ehLinkGoogleMaps(maps) && !errors.mapsUrl
  const onSubmit = form.handleSubmit(async (valores) => {
    const r = await props.acao(valores)
    if (!r.ok) {
      applyServerErrors(form, r)
      return
    }
    if (r.data?.aviso) toast.warning(r.data.aviso)
    else toast.success('Unidade salva')
    if (r.data) props.onSalvo?.(r.data.id)
  })

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <ErrorSummary errors={resumo} />
      <FormError form={form} />
      <fieldset disabled={props.somenteLeitura} className="flex flex-col gap-4">
        <Field id="nome" label={ROTULOS.nome} error={errors.nome?.message} required>
          {(a) => <TextInput {...a} placeholder="Ex.: Asa Sul" {...form.register('nome')} />}
        </Field>
        <Field id="endereco" label={ROTULOS.endereco} hint="Como o cliente encontra: quadra, bloco, rua e número" error={errors.endereco?.message}>
          {(a) => <TextInput {...a} placeholder="Ex.: SCLS 404 Bloco C" autoComplete="street-address" {...form.register('endereco')} />}
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field id="bairro" label={ROTULOS.bairro} error={errors.bairro?.message}>
            {(a) => <TextInput {...a} placeholder="Ex.: Asa Sul" {...form.register('bairro')} />}
          </Field>
          <Field id="cidade" label={ROTULOS.cidade} error={errors.cidade?.message}>
            {(a) => <TextInput {...a} placeholder="Ex.: Brasília" autoComplete="address-level2" {...form.register('cidade')} />}
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field id="uf" label={ROTULOS.uf} error={errors.uf?.message}>
            {(a) => <TextInput {...a} placeholder="Ex.: DF" maxLength={2} autoCapitalize="characters" autoComplete="address-level1" {...form.register('uf')} />}
          </Field>
          <Field id="cep" label={ROTULOS.cep} error={errors.cep?.message}>
            {(a) => <TextInput {...a} placeholder="Ex.: 70390-040" inputMode="numeric" autoComplete="postal-code" {...form.register('cep')} />}
          </Field>
        </div>
        <Field id="telefone" label={ROTULOS.telefone} error={errors.telefone?.message}>
          {(a) => <PhoneInput {...a} {...form.register('telefone')} />}
        </Field>
        <Controller
          name="apelidos"
          control={form.control}
          render={({ field }) => (
            <Field id="apelidos" label={ROTULOS.apelidos} hint="Outros nomes que os clientes usam. Digite e tecle Enter." error={errors.apelidos?.message}>
              {(a) => (
                <TagInput {...a} value={field.value} onChange={field.onChange} onBlur={field.onBlur} max={10} listLabel="Apelidos" placeholder="Ex.: 204 Sul" />
              )}
            </Field>
          )}
        />
        <div className="flex flex-col gap-1.5">
          <Field id="mapsUrl" label={ROTULOS.mapsUrl} hint="No app do Google Maps: Compartilhar → Copiar link" error={errors.mapsUrl?.message}>
            {(a) => <TextInput {...a} type="url" inputMode="url" placeholder="Ex.: https://maps.app.goo.gl/…" {...form.register('mapsUrl')} />}
          </Field>
          {mapsOk && (
            <p className="flex items-center gap-1.5 text-sm text-success">
              <CheckCircle2 aria-hidden="true" className="size-4" /> Link do Google Maps reconhecido
            </p>
          )}
        </div>
        <Controller
          name="ativo"
          control={form.control}
          render={({ field }) => (
            <SwitchField id="ativo" label="Unidade ativa" hint="Desativada, a IA deixa de responder sobre ela." checked={field.value} onCheckedChange={field.onChange} disabled={props.somenteLeitura ?? false} />
          )}
        />
      </fieldset>
      {!props.somenteLeitura && <SubmitButton pending={isSubmitting}>Salvar unidade</SubmitButton>}
    </form>
  )
}
