'use client'
import { Plus, Send, Users } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { criarConviteAction, definirAtivoAction, reenviarConviteAction } from '@/app/(painel)/mais/equipe/actions'
import { applyServerErrors, Field, FormError, Select, SubmitButton, SwitchField, TextInput, useZodForm } from '@/components/form'
import { EmptyState } from '@/components/shell/empty-state'
import { Button } from '@/components/ui/button'
import { chamarAcao, type ActionResult } from '@/lib/action-result'
import { conviteSchema, PAPEIS_CONVITE, type ConviteForm } from '@/lib/schemas/equipe'
import { Confirmar } from './confirmar'
import { FolhaFormulario } from './folha-formulario'

export type IntegranteTela = {
  tipo: 'membro' | 'convite'
  id: string
  nome: string
  email: string | null
  papel: 'dono' | 'gerente' | 'atendente'
  /** ids; vazio = todas as unidades */
  unidades: string[]
  ativo: boolean
  convitePendente?: boolean
  /** convite `enviado` de quem nunca entrou (para Reenviar) */
  conviteId?: string | null
  statusConvite?: 'pendente' | 'enviado' | 'erro' | 'aceito'
}
export type UnidadeOpcao = { id: string; nome: string }

const PAPEL = { dono: 'Dono', gerente: 'Gerente', atendente: 'Atendente' } as const
const VAZIO: ConviteForm = { email: '', nome: '', papel: 'atendente', todas: true, unidades: [] }

function ConviteFormulario(props: { unidades: UnidadeOpcao[]; onEnviado: () => void }) {
  const form = useZodForm(conviteSchema, { defaultValues: VAZIO })
  const { errors, isSubmitting } = form.formState
  const enviando = useRef(false)
  const todas = form.watch('todas')
  const escolhidas = form.watch('unidades')
  const onSubmit = form.handleSubmit(async () => {
    if (enviando.current) return
    enviando.current = true
    try {
      const r = await chamarAcao(() => criarConviteAction(form.getValues()))
      if (!r.ok) {
        applyServerErrors(form, r)
        return
      }
      toast.success('Convite enviado')
      props.onEnviado()
    } finally {
      enviando.current = false
    }
  })
  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <FormError form={form} />
      <Field id="nome" label="Nome" error={errors.nome?.message} required>
        {(a) => <TextInput {...a} maxLength={80} autoComplete="off" {...form.register('nome')} />}
      </Field>
      <Field id="email" label="E-mail" hint="Enviamos o convite para este endereço." error={errors.email?.message} required>
        {(a) => <TextInput {...a} type="email" inputMode="email" autoComplete="off" {...form.register('email')} />}
      </Field>
      <Field id="papel" label="Papel" error={errors.papel?.message} required>
        {(a) => (
          <Select {...a} {...form.register('papel')}>
            {PAPEIS_CONVITE.map((p) => <option key={p.valor} value={p.valor}>{p.rotulo}</option>)}
          </Select>
        )}
      </Field>
      <SwitchField
        id="todas"
        label="Todas as unidades"
        hint="Desligue para limitar o acesso a algumas unidades."
        checked={todas}
        onCheckedChange={(v) => form.setValue('todas', v, { shouldDirty: true, shouldValidate: true })}
      />
      {!todas && (
        <fieldset className="flex flex-col gap-1" aria-describedby={errors.unidades ? 'unidades-erro' : undefined}>
          <legend className="text-sm font-medium">Unidades permitidas</legend>
          {props.unidades.map((u) => (
            <label key={u.id} className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="size-5"
                checked={escolhidas.includes(u.id)}
                onChange={(e) =>
                  form.setValue('unidades', e.target.checked ? [...escolhidas, u.id] : escolhidas.filter((x) => x !== u.id), { shouldDirty: true, shouldValidate: true })}
              />
              {u.nome}
            </label>
          ))}
          {errors.unidades?.message && <p id="unidades-erro" role="alert" className="text-sm text-destructive">{errors.unidades.message}</p>}
        </fieldset>
      )}
      <SubmitButton pending={isSubmitting}>Enviar convite</SubmitButton>
    </form>
  )
}

function situacao(i: IntegranteTela): string {
  if (i.tipo === 'convite') return i.statusConvite === 'erro' ? 'Falha ao enviar o convite' : 'Enviando o convite…'
  if (!i.ativo) return 'Desativado'
  return i.convitePendente ? 'Convite enviado, aguardando o primeiro acesso' : 'Ativo'
}

/** Equipe do restaurante. Só o dono convida, reenvia e desativa; o gerente apenas vê a lista. */
export function Equipe(props: { integrantes: IntegranteTela[]; unidades: UnidadeOpcao[]; meuId: string; somenteLeitura: boolean }) {
  const [convidando, setConvidando] = useState(false)
  const [desativando, setDesativando] = useState<IntegranteTela | null>(null)
  const [ocupadoId, setOcupadoId] = useState<string | null>(null)
  const ocupado = useRef(false)
  const nomeDaUnidade = new Map(props.unidades.map((u) => [u.id, u.nome]))

  async function executar(id: string, acao: () => Promise<ActionResult<unknown>>, sucesso: string) {
    if (ocupado.current) return
    ocupado.current = true
    setOcupadoId(id)
    try {
      const r = await chamarAcao(acao)
      if (r.ok) toast.success(sucesso)
      else toast.error(r.formError ?? 'Não foi possível concluir agora.')
    } finally {
      ocupado.current = false
      setOcupadoId(null)
    }
  }

  return (
    <section aria-labelledby="equipe" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 id="equipe" className="font-display text-lg font-semibold">Equipe</h2>
          <p className="text-sm text-muted-foreground">Quem acessa o painel e em quais unidades.</p>
        </div>
        {!props.somenteLeitura && (
          <Button onClick={() => setConvidando(true)}><Plus aria-hidden="true" className="size-4" /> Convidar</Button>
        )}
      </div>
      {props.integrantes.length === 0 ? (
        <EmptyState icon={Users} title="Nenhum integrante" description="Convide gerentes e atendentes pelo e-mail." />
      ) : (
        <ul className="flex flex-col gap-2">
          {props.integrantes.map((i) => {
            const ehEu = i.tipo === 'membro' && i.id === props.meuId
            const escopo = i.unidades.length === 0 ? 'Todas as unidades' : i.unidades.map((u) => nomeDaUnidade.get(u) ?? 'Unidade removida').join(', ')
            return (
              <li key={`${i.tipo}-${i.id}`} aria-label={i.nome} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
                <div className="min-w-0">
                  <p className="break-words font-medium">{i.nome}{ehEu ? ' (você)' : ''} · {PAPEL[i.papel]}</p>
                  {i.email && <p className="break-all text-sm text-muted-foreground">{i.email}</p>}
                  <p className="text-sm text-muted-foreground">{escopo}</p>
                  <p className={`text-sm ${i.tipo === 'convite' && i.statusConvite === 'erro' ? 'text-destructive' : 'text-muted-foreground'}`}>{situacao(i)}</p>
                </div>
                {!props.somenteLeitura && !ehEu && (
                  <div className="flex flex-wrap gap-2">
                    {i.tipo === 'convite' && (
                      <Button
                        variant="outline"
                        disabled={ocupadoId !== null}
                        aria-label={`Reenviar convite para ${i.nome}`}
                        onClick={() => void executar(i.id, () => reenviarConviteAction(i.id), 'Convite reenviado')}
                      >
                        <Send aria-hidden="true" className="size-4" /> Reenviar convite
                      </Button>
                    )}
                    {i.tipo === 'membro' && i.convitePendente && i.conviteId && (
                      <Button
                        variant="outline"
                        disabled={ocupadoId !== null}
                        aria-label={`Reenviar convite para ${i.nome}`}
                        onClick={() => void executar(i.id, () => reenviarConviteAction(i.conviteId!), 'Convite reenviado')}
                      >
                        <Send aria-hidden="true" className="size-4" /> Reenviar convite
                      </Button>
                    )}
                    {i.tipo === 'membro' && i.papel !== 'dono' && (i.ativo ? (
                      <Button variant="outline" disabled={ocupadoId !== null} aria-label={`Desativar ${i.nome}`} onClick={() => setDesativando(i)}>Desativar</Button>
                    ) : (
                      <Button
                        variant="outline"
                        disabled={ocupadoId !== null}
                        aria-label={`Reativar ${i.nome}`}
                        onClick={() => void executar(i.id, () => definirAtivoAction(i.id, true), 'Acesso reativado')}
                      >
                        Reativar
                      </Button>
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <FolhaFormulario
        aberto={convidando}
        onAbertoChange={setConvidando}
        titulo="Convidar para a equipe"
        descricao="A pessoa recebe um e-mail para definir a senha e entrar."
      >
        {convidando && <ConviteFormulario unidades={props.unidades} onEnviado={() => setConvidando(false)} />}
      </FolhaFormulario>
      <Confirmar
        aberto={desativando !== null}
        onAbertoChange={(a) => !a && setDesativando(null)}
        titulo="Desativar acesso?"
        descricao={`${desativando?.nome ?? ''} perde o acesso ao painel agora. Você pode reativar depois.`}
        rotuloConfirmar="Desativar"
        rotuloAndamento="Desativando…"
        onConfirmar={async () => {
          const alvo = desativando
          if (!alvo) return
          setDesativando(null)
          await executar(alvo.id, () => definirAtivoAction(alvo.id, false), 'Acesso desativado')
        }}
      />
    </section>
  )
}
