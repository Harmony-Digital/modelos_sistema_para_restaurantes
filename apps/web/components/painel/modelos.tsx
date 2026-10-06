'use client'
import { Pencil, RotateCcw } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { MODELOS_S1, type ChaveModelo } from '@atd/core/s1'
import { restaurarModeloAction, salvarModeloAction } from '@/app/(painel)/conteudo/actions'
import { applyServerErrors, Field, FormError, SubmitButton, Textarea, useZodForm } from '@/components/form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { chamarAcao } from '@/lib/action-result'
import { previaModelo, ROTULOS_MODELO, type UnidadeExemplo } from '@/lib/modelos-tela'
import { modeloSchema } from '@/lib/schemas/respostas'
import { Confirmar } from './confirmar'
import { FolhaFormulario } from './folha-formulario'

const CHAVES = Object.keys(MODELOS_S1) as ChaveModelo[]

function ModeloForm(props: { chave: ChaveModelo; texto: string; unidade: UnidadeExemplo | null; onSalvo: () => void }) {
  const form = useZodForm(modeloSchema(props.chave), { defaultValues: { texto: props.texto } })
  const { errors, isSubmitting } = form.formState
  const texto = form.watch('texto') ?? ''
  const variaveis: readonly string[] = MODELOS_S1[props.chave].variaveis
  // Guarda síncrona contra duplo envio (Enter/duplo clique antes do re-render).
  const enviando = useRef(false)
  const onSubmit = form.handleSubmit(async (v) => {
    if (enviando.current) return
    enviando.current = true
    try {
      const r = await chamarAcao(() => salvarModeloAction(props.chave, v))
      if (!r.ok) {
        applyServerErrors(form, r)
        return
      }
      toast.success('Modelo salvo')
      props.onSalvo()
    } finally {
      enviando.current = false
    }
  })
  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <FormError form={form} />
      <Field
        id="texto"
        label="Texto"
        hint={variaveis.length ? `Variáveis: ${variaveis.map((v) => `{${v}}`).join(', ')}` : 'Este modelo não usa variáveis.'}
        error={errors.texto?.message}
        required
      >
        {(a) => <Textarea {...a} rows={4} {...form.register('texto')} />}
      </Field>
      <section aria-label="Prévia" className="rounded-lg bg-secondary p-3">
        <p className="mb-1 text-xs font-medium text-muted-foreground">Prévia com os seus dados</p>
        <p className="whitespace-pre-line text-sm text-foreground">{previaModelo(props.chave, texto, props.unidade)}</p>
      </section>
      <SubmitButton pending={isSubmitting}>Salvar modelo</SubmitButton>
    </form>
  )
}

export function Modelos(props: { personalizados: Partial<Record<ChaveModelo, string>>; unidade: UnidadeExemplo | null; somenteLeitura: boolean }) {
  const [editando, setEditando] = useState<ChaveModelo | null>(null)
  const [restaurando, setRestaurando] = useState<ChaveModelo | null>(null)
  const textoDe = (c: ChaveModelo) => props.personalizados[c] ?? MODELOS_S1[c].texto
  return (
    <>
      <ul className="flex flex-col gap-3">
        {CHAVES.map((c) => (
          <li key={c} aria-label={ROTULOS_MODELO[c].titulo} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-semibold text-foreground">
                  {ROTULOS_MODELO[c].titulo}
                  {props.personalizados[c] && <Badge variant="secondary">Personalizado</Badge>}
                </p>
                <p className="text-sm text-muted-foreground">{ROTULOS_MODELO[c].quando}</p>
              </div>
              {!props.somenteLeitura && (
                <div className="flex shrink-0">
                  <Button variant="ghost" size="icon" aria-label={`Editar: ${ROTULOS_MODELO[c].titulo}`} onClick={() => setEditando(c)}>
                    <Pencil aria-hidden="true" className="size-4" />
                  </Button>
                  {props.personalizados[c] && (
                    <Button variant="ghost" size="icon" aria-label={`Restaurar padrão: ${ROTULOS_MODELO[c].titulo}`} onClick={() => setRestaurando(c)}>
                      <RotateCcw aria-hidden="true" className="size-4" />
                    </Button>
                  )}
                </div>
              )}
            </div>
            <p className="whitespace-pre-line rounded-md bg-secondary p-3 text-sm text-foreground">{previaModelo(c, textoDe(c), props.unidade)}</p>
          </li>
        ))}
      </ul>
      <FolhaFormulario aberto={editando !== null} onAbertoChange={(a) => !a && setEditando(null)} titulo={editando ? ROTULOS_MODELO[editando].titulo : ''}>
        {editando && <ModeloForm chave={editando} texto={textoDe(editando)} unidade={props.unidade} onSalvo={() => setEditando(null)} />}
      </FolhaFormulario>
      <Confirmar
        aberto={restaurando !== null}
        onAbertoChange={(a) => !a && setRestaurando(null)}
        titulo="Voltar ao texto padrão?"
        descricao="O texto personalizado será apagado."
        rotuloConfirmar="Restaurar"
        rotuloAndamento="Restaurando…"
        onConfirmar={async () => {
          if (!restaurando) return
          try {
            const r = await restaurarModeloAction(restaurando)
            if (r.ok) toast.success('Texto padrão restaurado')
            else toast.error(r.formError ?? 'Não foi possível agora.')
          } catch {
            toast.error('Não foi possível restaurar agora. Tente de novo.')
          }
          setRestaurando(null)
        }}
      />
    </>
  )
}
