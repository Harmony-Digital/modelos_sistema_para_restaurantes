'use client'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { rotuloTipoEvento } from '@atd/core/s3'
import type { PedidoPainel } from '@atd/db'
import { revelarTelefoneAction, atualizarPedidoAction } from '@/app/(painel)/agenda/eventos-actions'
import { applyServerErrors, Field, FormError, Select, SubmitButton, Textarea, useZodForm } from '@/components/form'
import { Button } from '@/components/ui/button'
import { chamarAcao } from '@/lib/action-result'
import { dataDoEvento, linksTelefone, membrosDaUnidade, ROTULO_STATUS, statusPossiveis, type MembroTela } from '@/lib/eventos'
import { MAX_NOTAS, pedidoSchema } from '@/lib/schemas/eventos'
import { SeloSimulacao } from './selo-simulacao'
import { SeloStatus } from './selo-status'

const linkClass =
  'inline-flex min-h-11 items-center rounded-md border border-input px-4 text-sm font-medium text-link underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [@media(hover:hover)]:hover:bg-accent'

function Telefone({ pedidoId }: { pedidoId: string }) {
  // o número vive só neste estado: some quando a folha fecha (o componente desmonta)
  const [telefone, setTelefone] = useState<string | null>(null)
  const [buscando, setBuscando] = useState(false)
  const andando = useRef(false)
  const mostrar = async () => {
    if (andando.current) return
    andando.current = true
    setBuscando(true)
    try {
      const r = await chamarAcao(() => revelarTelefoneAction(pedidoId))
      if (r.ok && r.data) setTelefone(r.data.telefone)
      else toast.error(r.ok ? 'Não foi possível mostrar o telefone.' : (r.formError ?? 'Não foi possível mostrar o telefone.'))
    } finally {
      andando.current = false
      setBuscando(false)
    }
  }
  if (telefone === null) {
    return (
      <div className="flex flex-col gap-1.5">
        <Button type="button" variant="outline" className="self-start" aria-busy={buscando || undefined} disabled={buscando} onClick={mostrar}>
          Mostrar telefone
        </Button>
        <p className="text-sm text-muted-foreground">Cada consulta ao telefone fica registrada.</p>
      </div>
    )
  }
  const { tel, wa } = linksTelefone(telefone)
  return (
    <div className="flex flex-col gap-2">
      <p className="font-medium text-foreground">{telefone}</p>
      <div className="flex flex-wrap gap-2">
        <a href={tel} className={linkClass}>Ligar</a>
        <a href={wa} target="_blank" rel="noopener noreferrer" className={linkClass}>Abrir no WhatsApp</a>
        <Button type="button" variant="ghost" onClick={() => setTelefone(null)}>Ocultar telefone</Button>
      </div>
    </div>
  )
}

export function PedidoDetalhe(props: {
  pedido: PedidoPainel
  membros: MembroTela[]
  onSalvo: () => void
}) {
  const p = props.pedido
  const form = useZodForm(pedidoSchema, {
    defaultValues: { status: p.status, responsavelId: p.responsavelId ?? '', notasInternas: p.notasInternas ?? '' },
  })
  const { errors, isSubmitting } = form.formState
  // Guarda síncrona: duplo clique/Enter chega antes do re-render com pending.
  const enviando = useRef(false)
  const onSubmit = form.handleSubmit(async (valores) => {
    if (enviando.current) return
    enviando.current = true
    try {
      const r = await chamarAcao(() => atualizarPedidoAction(p.id, valores))
      if (!r.ok) {
        applyServerErrors(form, r)
        return
      }
      toast.success('Pedido atualizado.')
      props.onSalvo()
    } finally {
      enviando.current = false
    }
  })
  // responsável que saiu da equipe ainda aparece, para o select não mentir
  // só quem acessa a unidade do pedido pode ser responsável
  const doPedido = membrosDaUnidade(props.membros, p.unitId)
  const membros = p.responsavelId && !doPedido.some((m) => m.id === p.responsavelId)
    ? [...doPedido, { id: p.responsavelId, nome: p.responsavel ?? 'Ex-integrante' }]
    : doPedido
  const status = statusPossiveis(p.status)

  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Cliente</dt><dd className="flex flex-wrap items-center gap-2 break-words font-medium text-foreground">{p.nome ?? 'Sem nome'}{p.simulado && <SeloSimulacao />}</dd>
        <dt className="text-muted-foreground">Situação</dt><dd><SeloStatus status={p.status} /></dd>
        <dt className="text-muted-foreground">Data</dt><dd className="text-foreground">{dataDoEvento(p.data)}</dd>
        <dt className="text-muted-foreground">Convidados</dt><dd className="text-foreground">{p.convidados}</dd>
        <dt className="text-muted-foreground">Tipo</dt><dd className="text-foreground">{rotuloTipoEvento(p.tipo, p.tipoTexto)}</dd>
        <dt className="text-muted-foreground">Unidade</dt><dd className="text-foreground">{p.unidade}</dd>
        {p.espaco && (<><dt className="text-muted-foreground">Espaço</dt><dd className="text-foreground">{p.espaco}</dd></>)}
        {p.observacoes && (<><dt className="text-muted-foreground">Observações</dt><dd className="whitespace-pre-line break-words text-foreground">{p.observacoes}</dd></>)}
      </dl>

      {/* cliente simulado não tem telefone real: a DAL recusa, então nem mostra o botão */}
      {p.temTelefone && !p.simulado && <Telefone pedidoId={p.id} />}

      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        <FormError form={form} />
        <Field id="status" label="Status" {...(status.length === 1 ? { hint: 'Esse pedido já está encerrado.' } : {})} error={errors.status?.message}>
          {(a) => (
            <Select {...a} {...form.register('status')}>
              {status.map((s) => <option key={s} value={s}>{ROTULO_STATUS[s]}</option>)}
            </Select>
          )}
        </Field>
        <Field id="responsavelId" label="Responsável" error={errors.responsavelId?.message}>
          {(a) => (
            <Select {...a} {...form.register('responsavelId')}>
              <option value="">Ninguém</option>
              {membros.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </Select>
          )}
        </Field>
        <Field id="notasInternas" label="Notas internas" hint={`Só a equipe vê. Até ${MAX_NOTAS} caracteres.`} error={errors.notasInternas?.message}>
          {(a) => <Textarea {...a} rows={4} {...form.register('notasInternas')} />}
        </Field>
        <SubmitButton pending={isSubmitting}>Salvar</SubmitButton>
      </form>
    </div>
  )
}
