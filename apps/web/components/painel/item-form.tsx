'use client'
import { useRef } from 'react'
import { Controller } from 'react-hook-form'
import { toast } from 'sonner'
import {
  applyServerErrors, Field, FormError, Select, SubmitButton, SwitchField, TagInput, Textarea, TextInput, useZodForm,
} from '@/components/form'
import { MaskedInput } from '@/components/form/masked-input'
import { chamarAcao, type ActionResult } from '@/lib/action-result'
import { maskReais } from '@/lib/dinheiro'
import { itemSchema, ROTULO_TAG, TAGS_CARDAPIO, type ItemForm as Valores } from '@/lib/schemas/cardapio'
import { cn } from '@/lib/utils'

export function ItemForm(props: {
  inicial: Valores
  categorias: { id: string; nome: string }[]
  acao: (valores: Valores) => Promise<ActionResult<unknown>>
  onSalvo?: () => void
  rotuloSalvar: string
}) {
  const form = useZodForm(itemSchema, { defaultValues: props.inicial })
  const { errors, isSubmitting } = form.formState
  // Guarda síncrona: duplo clique/Enter chega antes do re-render com pending e criaria item duplicado.
  const enviando = useRef(false)
  const onSubmit = form.handleSubmit(async () => {
    if (enviando.current) return
    enviando.current = true
    try {
      const r = await chamarAcao(() => props.acao(form.getValues()))
      if (!r.ok) {
        applyServerErrors(form, r)
        return
      }
      toast.success('Item salvo. A IA já passa a usar o cardápio atualizado.')
      props.onSalvo?.()
    } finally {
      enviando.current = false
    }
  })
  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <FormError form={form} />
      <Field id="categoryId" label="Categoria" error={errors.categoryId?.message} required>
        {(a) => (
          <Select {...a} {...form.register('categoryId')}>
            <option value="" disabled>Escolha uma categoria</option>
            {props.categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </Select>
        )}
      </Field>
      <Field id="nome" label="Nome do item" error={errors.nome?.message} required>
        {(a) => <TextInput {...a} placeholder="Ex.: Picanha na brasa" {...form.register('nome')} />}
      </Field>
      <Field id="descricao" label="Descrição" hint="Opcional. A IA usa este texto ao falar do item." error={errors.descricao?.message}>
        {(a) => <Textarea {...a} rows={3} {...form.register('descricao')} />}
      </Field>
      <Field id="preco" label="Preço" hint="Deixe em branco para “preço sob consulta”. Digite só os números." error={errors.preco?.message}>
        {(a) => <MaskedInput {...a} mask={maskReais} placeholder="R$ 0,00" {...form.register('preco')} />}
      </Field>
      <Controller
        name="tags"
        control={form.control}
        render={({ field }) => (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm font-medium text-foreground">Etiquetas</legend>
            <div className="flex flex-wrap gap-2">
              {TAGS_CARDAPIO.map((t) => {
                const marcada = field.value.includes(t)
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={marcada}
                    onClick={() => field.onChange(marcada ? field.value.filter((x) => x !== t) : [...field.value, t])}
                    className={cn(
                      'min-h-11 rounded-full border px-4 text-sm font-medium transition-colors duration-150',
                      marcada ? 'border-transparent bg-primary text-primary-foreground' : 'border-border bg-card text-foreground',
                    )}
                  >
                    {ROTULO_TAG[t]}
                  </button>
                )
              })}
            </div>
          </fieldset>
        )}
      />
      <Controller
        name="outrosNomes"
        control={form.control}
        render={({ field }) => (
          <Field id="outrosNomes" label="Outros nomes" hint="Opcional. Como os clientes chamam o item. Tecle Enter a cada um." error={errors.outrosNomes?.message}>
            {(a) => <TagInput {...a} value={field.value} onChange={field.onChange} onBlur={field.onBlur} max={10} listLabel="Outros nomes" placeholder="Ex.: picanha" />}
          </Field>
        )}
      />
      <Controller
        name="disponivel"
        control={form.control}
        render={({ field }) => (
          <SwitchField id="disponivel" label="Disponível" hint="Em falta, a IA avisa que o item não está disponível." checked={field.value} onCheckedChange={field.onChange} />
        )}
      />
      <SubmitButton pending={isSubmitting}>{props.rotuloSalvar}</SubmitButton>
    </form>
  )
}
