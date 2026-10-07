'use client'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import type { PedidoTitular, ResumoTitular, RetencaoPainel } from '@atd/db'
import { applyServerErrors, Field, FormError, SubmitButton, Textarea, TextInput, useZodForm } from '@/components/form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { chamarAcao, type ActionResult } from '@/lib/action-result'
import {
  emAberto, nomeArquivoResumo, ROTULO_DADO_RETENCAO, ROTULO_STATUS_DSR, ROTULO_TIPO_DSR, situacaoPrazo, textoPrazo, textoResumo,
} from '@/lib/privacidade'
import {
  confirmouExclusao, correcaoSchema, MAX_RESPOSTA_NEGAR, negarSchema, PALAVRA_EXCLUSAO, retencaoSchema, type NegarForm, type RetencaoForm,
} from '@/lib/schemas/privacidade'
import { cn } from '@/lib/utils'
import { FolhaFormulario } from './folha-formulario'

export type AcoesPrivacidade = {
  gerarResumo: (id: string) => Promise<ActionResult<ResumoTitular>>
  revelarTelefone: (id: string) => Promise<ActionResult<{ telefone: string }>>
  concluirAcesso: (id: string) => Promise<ActionResult<null>>
  excluir: (id: string, confirmacao: string) => Promise<ActionResult<{ contagens: Record<string, number> }>>
  negar: (id: string, input: NegarForm) => Promise<ActionResult<null>>
  concluirCorrecao: (id: string, input: NegarForm) => Promise<ActionResult<null>>
}

const erroDe = (r: ActionResult<unknown>, padrao: string) => (r.ok ? padrao : (r.formError ?? padrao))
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

function dataCurta(d: Date, timeZone: string) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d)
}

/** "Mostrar telefone": o número vive só neste estado e some quando a folha fecha. */
function Telefone(props: { pedidoId: string; revelar: AcoesPrivacidade['revelarTelefone'] }) {
  const [telefone, setTelefone] = useState<string | null>(null)
  const [buscando, setBuscando] = useState(false)
  const andando = useRef(false)
  const mostrar = async () => {
    if (andando.current) return
    andando.current = true
    setBuscando(true)
    try {
      const r = await chamarAcao(() => props.revelar(props.pedidoId))
      if (r.ok && r.data) setTelefone(r.data.telefone)
      else toast.error(erroDe(r, 'Não foi possível mostrar o telefone.'))
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
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-medium text-foreground">{telefone}</span>
      <Button type="button" variant="ghost" onClick={() => setTelefone(null)}>Ocultar telefone</Button>
    </div>
  )
}

function ResumoAcesso(props: {
  pedidoId: string
  resumo: ResumoTitular
  timeZone: string
  acoes: AcoesPrivacidade
  onConcluido: () => void
}) {
  const texto = textoResumo(props.resumo, props.timeZone)
  const [concluindo, setConcluindo] = useState(false)
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto)
      toast.success('Resumo copiado.')
    } catch {
      toast.error('Não foi possível copiar. Selecione o texto e copie manualmente.')
    }
  }
  const baixar = () => {
    const url = URL.createObjectURL(new Blob([texto], { type: 'text/plain;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = nomeArquivoResumo(new Date(), props.timeZone)
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }
  const concluir = async () => {
    if (concluindo) return
    setConcluindo(true)
    try {
      const r = await chamarAcao(() => props.acoes.concluirAcesso(props.pedidoId))
      if (!r.ok) {
        toast.error(erroDe(r, 'Não foi possível concluir o pedido.'))
        return
      }
      toast.success('Pedido concluído.')
      props.onConcluido()
    } finally {
      setConcluindo(false)
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Envie este resumo ao cliente pelo canal que ele usou. Notas internas da equipe não entram.
      </p>
      <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted p-3 font-sans text-sm text-foreground">
        {texto}
      </pre>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={copiar}>Copiar</Button>
        <Button type="button" variant="outline" onClick={baixar}>Baixar .txt</Button>
      </div>
      <Telefone pedidoId={props.pedidoId} revelar={props.acoes.revelarTelefone} />
      <Button type="button" aria-busy={concluindo || undefined} disabled={concluindo} onClick={concluir}>
        {concluindo ? 'Concluindo…' : 'Marcar como concluído'}
      </Button>
    </div>
  )
}

function textoContagens(c: Record<string, number>) {
  const n = (k: string) => c[k] ?? 0
  return `Dados excluídos: ${plural(n('mensagens'), 'mensagem', 'mensagens')}, ${plural(n('conversas'), 'conversa', 'conversas')}, ` +
    `${plural(n('avisos'), 'reserva', 'reservas')} e ${plural(n('eventos'), 'pedido de evento', 'pedidos de evento')}.`
}

function ConfirmarExclusao(props: { pedidoId: string; excluir: AcoesPrivacidade['excluir']; onFechar: () => void }) {
  const [texto, setTexto] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [excluindo, setExcluindo] = useState(false)
  const pode = confirmouExclusao(texto)
  const confirmar = async () => {
    if (!pode || excluindo) return
    setExcluindo(true)
    setErro(null)
    try {
      const r = await chamarAcao(() => props.excluir(props.pedidoId, texto))
      if (!r.ok) {
        setErro(r.fieldErrors?.confirmacao ?? r.formError ?? 'Não foi possível excluir. Tente de novo.')
        return
      }
      toast.success(textoContagens(r.data?.contagens ?? {}))
      props.onFechar()
    } finally {
      setExcluindo(false)
    }
  }
  return (
    <Dialog open onOpenChange={(aberto) => { if (!aberto && !excluindo) props.onFechar() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Excluir os dados deste cliente?</DialogTitle>
          <DialogDescription>Esta ação não pode ser desfeita.</DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
          <li>As conversas e mensagens do cliente serão apagadas, inclusive uma conversa em atendimento.</li>
          <li>Reservas e pedidos de evento ficam anonimizados: somem nome, contato, observações e notas, mas a data e o número de pessoas continuam na agenda.</li>
          <li>O cadastro do cliente (telefone e nome no WhatsApp) é apagado.</li>
          <li>O pedido fica concluído e a exclusão é registrada sem dados pessoais.</li>
        </ul>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void confirmar()
          }}
        >
          <Field id="confirmacao-exclusao" label={`Para confirmar, digite ${PALAVRA_EXCLUSAO}`} error={erro ?? undefined}>
            {(a) => (
              <TextInput {...a} autoComplete="off" autoCapitalize="characters" spellCheck={false} value={texto} onChange={(e) => setTexto(e.target.value)} />
            )}
          </Field>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" disabled={excluindo} onClick={props.onFechar}>Cancelar</Button>
            <Button type="submit" variant="destructive" aria-busy={excluindo || undefined} disabled={!pode || excluindo}>
              {excluindo ? 'Excluindo…' : 'Excluir definitivamente'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RespostaPedido(props: {
  pedidoId: string
  enviar: (id: string, input: NegarForm) => Promise<ActionResult<null>>
  onFechar: () => void
  titulo: string
  descricao: string
  rotuloBotao: string
  rotuloAndamento: string
  sucesso: string
  schema: typeof negarSchema | typeof correcaoSchema
}) {
  const form = useZodForm(props.schema, { defaultValues: { resposta: '' } })
  const { errors, isSubmitting } = form.formState
  const enviando = useRef(false)
  const onSubmit = form.handleSubmit(async (v) => {
    if (enviando.current) return
    enviando.current = true
    try {
      const r = await chamarAcao(() => props.enviar(props.pedidoId, v))
      if (!r.ok) {
        applyServerErrors(form, r)
        return
      }
      toast.success(props.sucesso)
      props.onFechar()
    } finally {
      enviando.current = false
    }
  })
  return (
    <FolhaFormulario aberto onAbertoChange={(a) => { if (!a) props.onFechar() }} titulo={props.titulo} descricao={props.descricao}>
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        <FormError form={form} />
        <Field id="resposta" label="Resposta ao cliente" hint={`Sem dados pessoais. Até ${MAX_RESPOSTA_NEGAR} caracteres.`} error={errors.resposta?.message}>
          {(a) => <Textarea {...a} rows={3} {...form.register('resposta')} />}
        </Field>
        <SubmitButton pending={isSubmitting} pendingText={props.rotuloAndamento}>{props.rotuloBotao}</SubmitButton>
      </form>
    </FolhaFormulario>
  )
}

const TOM_PRAZO = { ok: 'text-muted-foreground', perto: 'text-warning font-medium', vencido: 'text-destructive font-medium', resolvido: 'text-muted-foreground' } as const

function ItemPedido(props: {
  pedido: PedidoTitular
  agora: Date
  timeZone: string
  acoes: AcoesPrivacidade
  onResumo: (id: string, r: ResumoTitular) => void
  onExcluir: (id: string) => void
  onNegar: (id: string) => void
  onCorrecao: (id: string) => void
}) {
  const p = props.pedido
  const [gerando, setGerando] = useState(false)
  const aberto = emAberto(p.status)
  const situacao = situacaoPrazo(p, props.agora)
  const gerar = async () => {
    if (gerando) return
    setGerando(true)
    try {
      const r = await chamarAcao(() => props.acoes.gerarResumo(p.id))
      if (r.ok && r.data) props.onResumo(p.id, r.data)
      else toast.error(erroDe(r, 'Não foi possível gerar o resumo.'))
    } finally {
      setGerando(false)
    }
  }
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-foreground">{ROTULO_TIPO_DSR[p.tipo]}</span>
        <Badge variant={aberto ? 'secondary' : 'outline'}>{ROTULO_STATUS_DSR[p.status]}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        Recebido em {dataCurta(p.criadoEm, props.timeZone)}
        {aberto && <> · <span className={cn(TOM_PRAZO[situacao])}>{textoPrazo(p, props.agora)}</span></>}
      </p>
      {!p.temCliente && <p className="text-sm text-muted-foreground">Os dados deste cliente já foram excluídos.</p>}
      {p.resposta && <p className="break-words text-sm text-foreground">Resposta: {p.resposta}</p>}
      {aberto && p.tipo === 'correcao' && (
        <p className="text-sm text-muted-foreground">Corrija o dado pelo atendimento (conversa ou agenda) e responda ao cliente.</p>
      )}
      {aberto && (
        <div className="flex flex-wrap gap-2">
          {p.tipo === 'acesso' && (
            <Button type="button" aria-busy={gerando || undefined} disabled={gerando} onClick={gerar}>
              {gerando ? 'Gerando…' : 'Gerar resumo'}
            </Button>
          )}
          {p.tipo === 'exclusao' && (
            <Button type="button" variant="destructive" onClick={() => props.onExcluir(p.id)}>Excluir dados</Button>
          )}
          {p.tipo === 'correcao' && <Button type="button" onClick={() => props.onCorrecao(p.id)}>Concluir correção</Button>}
          <Button type="button" variant="outline" onClick={() => props.onNegar(p.id)}>Negar</Button>
        </div>
      )}
    </li>
  )
}

/** Fila de pedidos do titular (dono/gerente). Prazo legal de 15 dias; ≤ 3 dias ou vencido aparece em destaque. */
export function FilaPrivacidade(props: { pedidos: PedidoTitular[]; agora: Date; timeZone: string; acoes: AcoesPrivacidade }) {
  const [resumo, setResumo] = useState<{ id: string; r: ResumoTitular } | null>(null)
  const [excluindo, setExcluindo] = useState<string | null>(null)
  const [negando, setNegando] = useState<string | null>(null)
  const [corrigindo, setCorrigindo] = useState<string | null>(null)
  const abertos = props.pedidos.filter((p) => emAberto(p.status))
  const resolvidos = props.pedidos.filter((p) => !emAberto(p.status))
  const item = (p: PedidoTitular) => (
    <ItemPedido
      key={p.id}
      pedido={p}
      agora={props.agora}
      timeZone={props.timeZone}
      acoes={props.acoes}
      onResumo={(id, r) => setResumo({ id, r })}
      onExcluir={setExcluindo}
      onNegar={setNegando}
      onCorrecao={setCorrigindo}
    />
  )
  return (
    <div className="flex flex-col gap-4">
      {abertos.length === 0
        ? <p className="text-sm text-muted-foreground">Nenhum pedido em aberto.</p>
        : <ul className="flex flex-col gap-3">{abertos.map(item)}</ul>}
      {resolvidos.length > 0 && (
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-link">Resolvidos ({resolvidos.length})</summary>
          <ul className="mt-2 flex flex-col gap-3">{resolvidos.map(item)}</ul>
        </details>
      )}
      {resumo && (
        <FolhaFormulario aberto onAbertoChange={(a) => { if (!a) setResumo(null) }} titulo="Resumo de acesso" descricao="Dados que o restaurante guarda sobre este cliente.">
          <ResumoAcesso pedidoId={resumo.id} resumo={resumo.r} timeZone={props.timeZone} acoes={props.acoes} onConcluido={() => setResumo(null)} />
        </FolhaFormulario>
      )}
      {excluindo && <ConfirmarExclusao pedidoId={excluindo} excluir={props.acoes.excluir} onFechar={() => setExcluindo(null)} />}
      {negando && (
        <RespostaPedido
          pedidoId={negando}
          enviar={props.acoes.negar}
          schema={negarSchema}
          onFechar={() => setNegando(null)}
          titulo="Negar pedido"
          descricao="Explique o motivo ao cliente em poucas palavras."
          rotuloBotao="Negar pedido"
          rotuloAndamento="Negando…"
          sucesso="Pedido negado."
        />
      )}
      {corrigindo && (
        <RespostaPedido
          pedidoId={corrigindo}
          enviar={props.acoes.concluirCorrecao}
          schema={correcaoSchema}
          onFechar={() => setCorrigindo(null)}
          titulo="Concluir correção"
          descricao="Diga ao cliente o que foi corrigido, em poucas palavras."
          rotuloBotao="Concluir correção"
          rotuloAndamento="Concluindo…"
          sucesso="Correção concluída."
        />
      )}
    </div>
  )
}

function LinhaRetencao(props: { item: RetencaoPainel; acao: (v: RetencaoForm) => Promise<ActionResult<null>> }) {
  const { item } = props
  const rotulo = ROTULO_DADO_RETENCAO[item.dado]
  const id = `retencao-${item.dado}`
  const [valor, setValor] = useState(String(item.dias))
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const salvar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (salvando) return
    const v = { dado: item.dado, dias: valor.trim() === '' ? Number.NaN : Number(valor) }
    const p = retencaoSchema.safeParse(v)
    if (!p.success) {
      setErro(p.error.issues[0]?.message ?? 'Valor inválido')
      return
    }
    setErro(null)
    setSalvando(true)
    try {
      const r = await chamarAcao(() => props.acao(p.data))
      if (!r.ok) {
        setErro(r.fieldErrors?.dias ?? r.formError ?? 'Não foi possível salvar.')
        return
      }
      toast.success('Prazo salvo.')
    } finally {
      setSalvando(false)
    }
  }
  return (
    <li>
      <form noValidate onSubmit={salvar} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
        <Field id={id} label={`${rotulo.titulo} (dias)`} hint={`${rotulo.descricao} Mínimo de ${item.minimo} dias.`} error={erro ?? undefined}>
          {(a) => (
            <TextInput {...a} type="number" inputMode="numeric" min={item.minimo} step={1} value={valor} onChange={(e) => setValor(e.target.value)} />
          )}
        </Field>
        <SubmitButton pending={salvando} className="self-start">Salvar</SubmitButton>
      </form>
    </li>
  )
}

/** Prazos de retenção: o dono edita (com os mínimos); o gerente só vê. O áudio é descartado após a transcrição (fixo). */
export function PrazosRetencao(props: { itens: RetencaoPainel[]; acao: (v: RetencaoForm) => Promise<ActionResult<null>>; somenteLeitura?: boolean }) {
  if (props.somenteLeitura) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">Só o dono altera os prazos.</p>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 rounded-lg border border-border bg-card p-4 text-sm">
          {props.itens.map((i) => (
            <div key={i.dado} className="contents">
              <dt className="text-foreground">{ROTULO_DADO_RETENCAO[i.dado].titulo}</dt>
              <dd className="text-right tabular-nums text-foreground">{plural(i.dias, 'dia', 'dias')}</dd>
            </div>
          ))}
          <dt className="text-foreground">Áudios</dt>
          <dd className="text-right text-muted-foreground">Descartados após a transcrição</dd>
        </dl>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">{props.itens.map((i) => <LinhaRetencao key={i.dado} item={i} acao={props.acao} />)}</ul>
      <p className="text-sm text-muted-foreground">Áudios são descartados logo após a transcrição.</p>
    </div>
  )
}
