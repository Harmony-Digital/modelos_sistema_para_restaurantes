'use client'
import { Eye, FileText, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { ativarArquivoAction, enviarArquivoAction, urlPreviaArquivoAction } from '@/app/(painel)/conteudo/cardapio-actions'
import { Field, Select, SubmitButton, TextInput } from '@/components/form'
import { EmptyState } from '@/components/shell/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { chamarAcao } from '@/lib/action-result'
import { LIMITE_ARQUIVO_BYTES, LIMITE_ARQUIVO_MB, MENSAGEM_LIMITE } from '@/lib/arquivo-cardapio'
import { cn } from '@/lib/utils'

export type ArquivoTela = { id: string; unitId: string | null; titulo: string; mime: string; tamanho: number; ativo: boolean; criadoEm: string }

const tamanhoLegivel = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)
const tipoLegivel = (m: string) => (m === 'application/pdf' ? 'PDF' : 'Imagem')

type Erros = { arquivo?: string; titulo?: string; unitId?: string; geral?: string }

export function ArquivosCardapio(props: {
  arquivos: ArquivoTela[]
  unidades: { id: string; nome: string }[]
  /** Dono/gerente podem enviar; atendente só consulta. */
  podeEnviar: boolean
  /** Arquivo "para todas as unidades" só com acesso a todas elas. */
  podeGeral: boolean
}) {
  const [titulo, setTitulo] = useState('')
  const [unitId, setUnitId] = useState(props.podeGeral ? '' : (props.unidades[0]?.id ?? ''))
  const [erros, setErros] = useState<Erros>({})
  const [enviando, setEnviando] = useState(false)
  const [previa, setPrevia] = useState<{ url: string; mime: string; titulo: string } | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const emAndamento = useRef(false)
  const entrada = useRef<HTMLInputElement>(null)
  const nomeUnidade = (id: string | null) => (id === null ? 'Todas as unidades' : (props.unidades.find((u) => u.id === id)?.nome ?? 'Outra unidade'))
  const podeMexer = (a: ArquivoTela) => props.podeEnviar && (a.unitId !== null || props.podeGeral)

  const enviar = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (emAndamento.current) return
    const arquivo = entrada.current?.files?.[0]
    if (!arquivo) return setErros({ arquivo: 'Escolha o arquivo do cardápio.' })
    if (arquivo.size > LIMITE_ARQUIVO_BYTES) return setErros({ arquivo: MENSAGEM_LIMITE })
    emAndamento.current = true
    setEnviando(true)
    setErros({})
    try {
      const fd = new FormData()
      fd.set('arquivo', arquivo)
      fd.set('titulo', titulo)
      fd.set('unitId', unitId)
      const r = await chamarAcao(() => enviarArquivoAction(fd))
      if (!r.ok) {
        setErros({ ...r.fieldErrors, ...(r.formError ? { geral: r.formError } : {}) })
        return
      }
      toast.success('Arquivo enviado')
      setTitulo('')
      if (entrada.current) entrada.current.value = ''
    } finally {
      emAndamento.current = false
      setEnviando(false)
    }
  }

  const abrirPrevia = async (a: ArquivoTela) => {
    setOcupado(a.id)
    const r = await chamarAcao(() => urlPreviaArquivoAction(a.id))
    setOcupado(null)
    if (r.ok && r.data) setPrevia(r.data)
    else toast.error(r.ok ? 'Não foi possível abrir o arquivo agora.' : (r.formError ?? 'Não foi possível abrir o arquivo agora.'))
  }

  const alternar = async (a: ArquivoTela) => {
    setOcupado(a.id)
    const r = await chamarAcao(() => ativarArquivoAction(a.id, !a.ativo))
    setOcupado(null)
    if (r.ok) toast.success(a.ativo ? 'Arquivo desativado' : 'Arquivo ativado')
    else toast.error(r.formError ?? 'Não foi possível alterar agora.')
  }

  return (
    <div className="flex flex-col gap-4">
      {props.podeEnviar && (
        <form noValidate onSubmit={enviar} className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
          <h2 className="text-base font-semibold text-foreground">Enviar arquivo do cardápio</h2>
          {erros.geral && <p role="alert" className="text-sm text-destructive">{erros.geral}</p>}
          <Field id="arquivo" label="Arquivo" hint={`PDF, JPEG, PNG ou WebP, até ${LIMITE_ARQUIVO_MB} MB.`} error={erros.arquivo} required>
            {(a) => (
              <input
                {...a}
                ref={entrada}
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                className={cn('min-h-11 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium')}
              />
            )}
          </Field>
          <Field id="titulo" label="Título" error={erros.titulo} required>
            {(a) => <TextInput {...a} value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Cardápio do almoço" />}
          </Field>
          <Field id="unitId" label="Vale para" error={erros.unitId}>
            {(a) => (
              <Select {...a} value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                {props.podeGeral && <option value="">Todas as unidades</option>}
                {props.unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
              </Select>
            )}
          </Field>
          <SubmitButton pending={enviando} pendingText="Enviando…">
            <Upload aria-hidden="true" className="size-4" /> Enviar arquivo
          </SubmitButton>
        </form>
      )}
      {props.arquivos.length === 0 ? (
        <EmptyState icon={FileText} title="Nenhum arquivo enviado" description="Envie o PDF ou a foto do cardápio para a IA poder mandá-lo aos clientes." />
      ) : (
        <ul className="flex flex-col gap-3">
          {props.arquivos.map((a) => (
            <li key={a.id} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-semibold text-foreground">
                  {a.titulo}
                  {!a.ativo && <Badge variant="secondary">Desativado</Badge>}
                </p>
                <p className="text-sm text-muted-foreground">{nomeUnidade(a.unitId)} · {tipoLegivel(a.mime)} · {tamanhoLegivel(a.tamanho)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" disabled={ocupado === a.id} onClick={() => abrirPrevia(a)}>
                  <Eye aria-hidden="true" className="size-4" /> Ver prévia<span className="sr-only">: {a.titulo}</span>
                </Button>
                {podeMexer(a) && (
                  <Button variant="outline" size="sm" disabled={ocupado === a.id} onClick={() => alternar(a)}>
                    {a.ativo ? 'Desativar' : 'Ativar'}<span className="sr-only">: {a.titulo}</span>
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={previa !== null} onOpenChange={(o) => !o && setPrevia(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{previa?.titulo}</DialogTitle>
            <DialogDescription>O link da prévia expira em poucos minutos.</DialogDescription>
          </DialogHeader>
          {previa && (previa.mime.startsWith('image/')
            ? <img src={previa.url} alt={`Prévia de ${previa.titulo}`} className="w-full rounded-md" />
            : <a href={previa.url} target="_blank" rel="noopener noreferrer" className="text-link underline">Abrir o PDF em outra aba</a>)}
        </DialogContent>
      </Dialog>
    </div>
  )
}
