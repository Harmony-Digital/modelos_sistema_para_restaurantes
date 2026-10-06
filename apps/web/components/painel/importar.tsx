'use client'
import { Download, FileSpreadsheet, FileUp, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { estadoImportacaoAction, importarArquivoAction, importarCsvAction } from '@/app/(painel)/conteudo/importar-actions'
import { Field, SubmitButton } from '@/components/form'
import { Badge } from '@/components/ui/badge'
import { chamarAcao } from '@/lib/action-result'
import { URL_IMPORTAR, urlImportacao } from '@/lib/importacao'
import { LIMITE_ARQUIVO_BYTES } from '@/lib/arquivo-cardapio'
import { cn } from '@/lib/utils'

export type StatusImportacaoTela = 'enviado' | 'processando' | 'rascunho' | 'aprovado' | 'rejeitado' | 'erro'
export type ImportacaoTela = { id: string; origem: 'csv' | 'arquivo'; mime: string; status: StatusImportacaoTela; criadoEm: string }


const ROTULO_STATUS: Record<StatusImportacaoTela, string> = {
  enviado: 'Na fila',
  processando: 'Lendo',
  rascunho: 'Para revisar',
  aprovado: 'Aplicada',
  rejeitado: 'Descartada',
  erro: 'Não foi lida',
}
const VARIANTE_STATUS: Record<StatusImportacaoTela, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  enviado: 'outline',
  processando: 'outline',
  rascunho: 'default',
  aprovado: 'secondary',
  rejeitado: 'secondary',
  erro: 'destructive',
}
const LENDO: StatusImportacaoTela[] = ['enviado', 'processando']

const tipo = (i: ImportacaoTela) => (i.origem === 'csv' ? 'Planilha CSV' : i.mime === 'application/pdf' ? 'PDF' : 'Foto')
const quando = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

const classeArquivo =
  'min-h-11 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium'

/** Sub-aba Importar: planilha CSV (lida no servidor) ou PDF/foto (lida pela IA), e as importações recentes. */
export function Importar(props: { importacoes: ImportacaoTela[] }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Nada entra no cardápio sem a sua revisão: depois de ler o arquivo, você confere cada item e confirma.
      </p>
      <ImportarCsv />
      <ImportarArquivo />
      <section aria-labelledby="importacoes-recentes" className="flex flex-col gap-3">
        <h2 id="importacoes-recentes" className="text-base font-semibold text-foreground">Importações recentes</h2>
        {props.importacoes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma importação ainda.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {props.importacoes.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{tipo(i)}</p>
                  <p className="text-sm text-muted-foreground">{quando(i.criadoEm)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant={VARIANTE_STATUS[i.status]}>{ROTULO_STATUS[i.status]}</Badge>
                  {i.status !== 'rejeitado' && (
                    <Link href={urlImportacao(i.id)} className="inline-flex min-h-11 items-center text-sm font-medium text-link underline-offset-4 hover:underline">
                      Abrir<span className="sr-only">: {tipo(i)} de {quando(i.criadoEm)}</span>
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function ImportarCsv() {
  const router = useRouter()
  const entrada = useRef<HTMLInputElement>(null)
  const emAndamento = useRef(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | undefined>()
  const [errosLinhas, setErrosLinhas] = useState<string[]>([])

  const enviar = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (emAndamento.current) return
    const arquivo = entrada.current?.files?.[0]
    setErrosLinhas([])
    if (!arquivo) return setErro('Escolha a planilha CSV.')
    emAndamento.current = true
    setEnviando(true)
    setErro(undefined)
    try {
      const fd = new FormData()
      fd.set('arquivo', arquivo)
      const r = await chamarAcao(() => importarCsvAction(fd))
      if (!r.ok) return setErro(r.fieldErrors?.arquivo ?? r.formError)
      if (!r.data) return
      if (r.data.id === null) return setErrosLinhas(r.data.erros)
      router.push(urlImportacao(r.data.id))
    } finally {
      emAndamento.current = false
      setEnviando(false)
    }
  }

  return (
    <form noValidate onSubmit={enviar} className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
        <FileSpreadsheet aria-hidden="true" className="size-5" /> Planilha
      </h2>
      <p className="text-sm text-muted-foreground">
        Colunas: categoria, nome, descricao, preco, tags, outros_nomes, unidade. Tags e outros nomes separados por “|”.
      </p>
      <a href="/modelo-cardapio.csv" download className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-link underline-offset-4 hover:underline">
        <Download aria-hidden="true" className="size-4" /> Baixar o modelo de planilha
      </a>
      <Field id="importar-csv" label="Planilha CSV" hint="Até 2 MB. No Excel: Salvar como → CSV." error={erro} required>
        {(a) => <input {...a} ref={entrada} type="file" accept=".csv,text/csv" className={classeArquivo} />}
      </Field>
      {errosLinhas.length > 0 && (
        <div role="alert" className="flex flex-col gap-2 rounded-md border border-destructive/40 p-3 text-sm text-destructive">
          <p className="font-medium">
            A planilha tem {errosLinhas.length} {errosLinhas.length === 1 ? 'erro' : 'erros'}. Corrija e envie de novo.
          </p>
          <ul className="list-disc pl-5">
            {errosLinhas.map((m) => <li key={m}>{m}</li>)}
          </ul>
        </div>
      )}
      <SubmitButton pending={enviando} pendingText="Lendo…">Ler planilha</SubmitButton>
    </form>
  )
}

function ImportarArquivo() {
  const router = useRouter()
  const entrada = useRef<HTMLInputElement>(null)
  const emAndamento = useRef(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | undefined>()
  const [erroGeral, setErroGeral] = useState<string | undefined>()

  const enviar = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (emAndamento.current) return
    const arquivo = entrada.current?.files?.[0]
    setErroGeral(undefined)
    if (!arquivo) return setErro('Escolha o arquivo do cardápio.')
    if (arquivo.size > LIMITE_ARQUIVO_BYTES) return setErro('O arquivo passa de 20 MB. Envie um menor.')
    emAndamento.current = true
    setEnviando(true)
    setErro(undefined)
    try {
      const fd = new FormData()
      fd.set('arquivo', arquivo)
      const r = await chamarAcao(() => importarArquivoAction(fd))
      if (!r.ok) {
        setErro(r.fieldErrors?.arquivo)
        setErroGeral(r.formError)
        return
      }
      if (!r.data) return
      if (r.data.status !== 'enviado') toast.info('Esse arquivo já tinha sido enviado. Mostrando a importação dele.')
      router.push(urlImportacao(r.data.id))
    } finally {
      emAndamento.current = false
      setEnviando(false)
    }
  }

  return (
    <form noValidate onSubmit={enviar} className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
        <FileUp aria-hidden="true" className="size-5" /> PDF ou foto do cardápio
      </h2>
      <p className="text-sm text-muted-foreground">A IA lê o arquivo e monta uma lista de itens para você revisar.</p>
      {erroGeral && <p role="alert" className="text-sm text-destructive">{erroGeral}</p>}
      <Field id="importar-arquivo" label="PDF ou foto" hint="PDF, JPEG, PNG ou WebP, até 20 MB." error={erro} required>
        {(a) => <input {...a} ref={entrada} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className={classeArquivo} />}
      </Field>
      <SubmitButton pending={enviando} pendingText="Enviando…">Enviar para leitura</SubmitButton>
    </form>
  )
}

const INTERVALO_MS = 3000

/** Acompanha a leitura por IA: consulta o status a cada 3 s e recarrega a tela quando sai da fila/leitura. */
export function AcompanharImportacao(props: { id: string; status: StatusImportacaoTela; erro: string | null }) {
  const router = useRouter()
  const consultando = useRef(false)
  const lendo = LENDO.includes(props.status)

  useEffect(() => {
    if (!lendo) return
    let ativo = true
    const t = setInterval(async () => {
      if (consultando.current) return
      consultando.current = true
      try {
        const r = await chamarAcao(() => estadoImportacaoAction(props.id))
        if (ativo && r.ok && r.data && !LENDO.includes(r.data.status)) {
          clearInterval(t)
          router.refresh()
        }
      } finally {
        consultando.current = false
      }
    }, INTERVALO_MS)
    return () => {
      ativo = false
      clearInterval(t)
    }
  }, [lendo, props.id, router])

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      {lendo ? (
        <div role="status" className="flex items-center gap-3 text-foreground">
          <Loader2 aria-hidden="true" className="size-5 animate-spin" />
          <div>
            <p className="font-medium">Lendo o cardápio…</p>
            <p className="text-sm text-muted-foreground">Pode levar até um minuto. A revisão abre aqui quando terminar.</p>
          </div>
        </div>
      ) : (
        <p role="alert" className={cn('text-sm text-destructive')}>{props.erro ?? 'Não foi possível ler esse arquivo.'}</p>
      )}
      <Link href={URL_IMPORTAR} className="inline-flex min-h-11 items-center text-sm font-medium text-link underline-offset-4 hover:underline">
        {lendo ? 'Voltar às importações' : 'Enviar outro arquivo'}
      </Link>
    </div>
  )
}
