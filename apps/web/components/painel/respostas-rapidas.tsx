'use client'
import { MessageSquareText, Pencil, Plus } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { salvarRespostaRapidaAction } from '@/app/(painel)/mais/atendimento-humano/actions'
import { applyServerErrors, Field, FormError, SubmitButton, SwitchField, Textarea, TextInput, useZodForm } from '@/components/form'
import { EmptyState } from '@/components/shell/empty-state'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { chamarAcao } from '@/lib/action-result'
import { MAX_RESPOSTAS_ATIVAS, respostaRapidaSchema, type RespostaRapidaForm as Valores } from '@/lib/schemas/atendimento'
import { FolhaFormulario } from './folha-formulario'

export type RespostaRapidaTela = { id: string; titulo: string; texto: string; ativo: boolean }

const VAZIO: Valores = { titulo: '', texto: '', ativo: true }

function RespostaForm(props: { id: string | null; inicial: Valores; onSalvo: () => void }) {
  const form = useZodForm(respostaRapidaSchema, { defaultValues: props.inicial })
  const { errors, isSubmitting } = form.formState
  const enviando = useRef(false)
  const onSubmit = form.handleSubmit(async () => {
    if (enviando.current) return
    enviando.current = true
    try {
      const r = await chamarAcao(() => salvarRespostaRapidaAction(props.id, form.getValues()))
      if (!r.ok) {
        applyServerErrors(form, r)
        return
      }
      toast.success('Resposta salva')
      props.onSalvo()
    } finally {
      enviando.current = false
    }
  })
  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <FormError form={form} />
      <Field id="titulo" label="Título" hint="Só a equipe vê. Até 40 caracteres." error={errors.titulo?.message} required>
        {(a) => <TextInput {...a} maxLength={40} autoComplete="off" placeholder="Ex.: Boas-vindas" {...form.register('titulo')} />}
      </Field>
      <Field id="texto" label="Texto" hint="Enviado ao cliente como está escrito. Até 1000 caracteres." error={errors.texto?.message} required>
        {(a) => <Textarea {...a} rows={5} {...form.register('texto')} />}
      </Field>
      <SwitchField
        id="ativo"
        label="Ativa"
        hint={`Aparece na conversa. Até ${MAX_RESPOSTAS_ATIVAS} ativas.`}
        checked={form.watch('ativo')}
        onCheckedChange={(v) => form.setValue('ativo', v, { shouldDirty: true })}
      />
      <SubmitButton pending={isSubmitting}>Salvar resposta</SubmitButton>
    </form>
  )
}

/** Respostas prontas que a equipe usa na conversa. Dono/gerente editam; atendente só consulta. */
export function RespostasRapidas(props: { respostas: RespostaRapidaTela[]; somenteLeitura: boolean }) {
  const [editando, setEditando] = useState<{ id: string | null; valores: Valores } | null>(null)
  const [trocando, setTrocando] = useState<string | null>(null)
  const ocupado = useRef(false)
  const ativas = props.respostas.filter((r) => r.ativo).length

  async function alternar(r: RespostaRapidaTela, ativo: boolean) {
    if (ocupado.current) return
    ocupado.current = true
    setTrocando(r.id)
    try {
      const res = await chamarAcao(() => salvarRespostaRapidaAction(r.id, { titulo: r.titulo, texto: r.texto, ativo }))
      if (res.ok) toast.success(ativo ? 'Resposta ativada' : 'Resposta desativada')
      else toast.error(res.formError ?? 'Não foi possível salvar agora.')
    } finally {
      ocupado.current = false
      setTrocando(null)
    }
  }

  return (
    <section aria-labelledby="respostas-rapidas" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 id="respostas-rapidas" className="font-display text-lg font-semibold">Respostas rápidas</h2>
          <p className="text-sm text-muted-foreground">Textos prontos para a equipe usar nas conversas ({ativas} de {MAX_RESPOSTAS_ATIVAS} ativas).</p>
        </div>
        {!props.somenteLeitura && (
          <Button onClick={() => setEditando({ id: null, valores: VAZIO })}>
            <Plus aria-hidden="true" className="size-4" /> Nova resposta
          </Button>
        )}
      </div>
      {props.respostas.length === 0 ? (
        <EmptyState
          icon={MessageSquareText}
          title="Nenhuma resposta rápida"
          description="Cadastre textos que a equipe repete, como a saudação ou o aviso de que já vai atender."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {props.respostas.map((r) => (
            <li key={r.id} aria-label={r.titulo} className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
              <div className="min-w-0 flex-1">
                <p className="break-words font-medium">{r.titulo}{r.ativo ? '' : ' · Inativa'}</p>
                <p className="line-clamp-2 whitespace-pre-line break-words text-sm text-muted-foreground">{r.texto}</p>
              </div>
              {!props.somenteLeitura && (
                <>
                  <Switch aria-label={`Ativa: ${r.titulo}`} checked={r.ativo} disabled={trocando !== null} onCheckedChange={(v) => void alternar(r, v)} />
                  <Button variant="ghost" size="icon" aria-label={`Editar resposta ${r.titulo}`} onClick={() => setEditando({ id: r.id, valores: { titulo: r.titulo, texto: r.texto, ativo: r.ativo } })}>
                    <Pencil aria-hidden="true" className="size-4" />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <FolhaFormulario
        aberto={editando !== null}
        onAbertoChange={(a) => !a && setEditando(null)}
        titulo={editando?.id ? 'Editar resposta' : 'Nova resposta'}
        descricao="O texto vai para o cliente exatamente como está aqui."
      >
        {editando && <RespostaForm id={editando.id} inicial={editando.valores} onSalvo={() => setEditando(null)} />}
      </FolhaFormulario>
    </section>
  )
}
