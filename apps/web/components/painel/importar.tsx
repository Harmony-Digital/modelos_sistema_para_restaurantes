'use client'
import { Download, FileSpreadsheet, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { descartarImportacaoAction, estadoImportacaoAction, importarCsvAction } from '@/app/(painel)/conteudo/importar-actions'
import { Field, SubmitButton } from '@/components/form'
import { Confirmar } from '@/components/painel/confirmar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { chamarAcao } from '@/lib/action-result'
import { URL_IMPORTAR, urlImportacao } from '@/lib/importacao'

export type StatusImportacaoTela = 'enviado' | 'processando' | 'rascunho' | 'aprovado' | 'rejeitado' | 'erro'
export type ImportacaoTela = {
  id: string
  origem: 'csv' | 'arquivo'
  modo: 'completo' | 'so_precos'
  mime: string
  /** quantos arquivos (CSV = 0) */
  arquivos: number
  status: StatusImportacaoTela
  /** vários arquivos antes de "Ler arquivos" */
  recebendo: boolean
  criadoEm: string
}


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

export const tipoMime = (mime: string) => (mime === 'application/pdf' ? 'PDF' : 'Foto')
function tipo(i: ImportacaoTela): string {
  const base = i.origem === 'csv' ? 'Planilha CSV' : i.arquivos > 1 ? `${i.arquivos} arquivos` : i.arquivos === 0 ? 'Sem arquivos' : tipoMime(i.mime)
  return i.modo === 'so_precos' ? `${base} · só preços` : base
}
const quando = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

export const classeArquivo =
  'min-h-11 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium'

/** Importações recentes (de um alvo), com o estado de cada uma. */
export function HistoricoImportacoes(props: { importacoes: ImportacaoTela[]; vazio: string }) {
  return (
    <section aria-labelledby="importacoes-recentes" className="flex flex-col gap-3">
      <h2 id="importacoes-recentes" className="text-base font-semibold text-foreground">Importações recentes</h2>
      {props.importacoes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{props.vazio}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {props.importacoes.map((i) => (
            <li key={i.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-3">
              <div className="min-w-0">
                <p className="font-medium text-foreground">{tipo(i)}</p>
                <p className="text-sm text-muted-foreground">{quando(i.criadoEm)}</p>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant={i.recebendo ? 'outline' : VARIANTE_STATUS[i.status]}>{i.recebendo ? 'Recebendo arquivos' : ROTULO_STATUS[i.status]}</Badge>
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
  )
}

/** Planilha CSV do cardápio, lida no servidor (sem IA). */
export function ImportarCsv() {
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

const INTERVALO_MS = 3000
/** Mais que isso em fila/leitura: algo travou (worker parado, fila cheia); o usuário reenvia. */
const LIMITE_LEITURA_MS = 5 * 60_000
const DEMORANDO = 'A leitura está demorando. Tente enviar de novo.'

/**
 * Acompanha a leitura por IA: consulta o status a cada 3 s e recarrega a tela quando sai da fila/leitura. Para de
 * consultar se a consulta falhar ou se a leitura passar de 5 minutos (contados de `desde`, a criação da importação).
 * Vários arquivos (`lotes`): mostra "Lendo n de m" e os 5 minutos contam da abertura da tela ou do último lote lido.
 * Importação com erro pode ser descartada.
 */
export function AcompanharImportacao(props: {
  id: string
  status: StatusImportacaoTela
  erro: string | null
  desde: string
  /** padrão "Lendo o cardápio…" */
  titulo?: string
  /** leitura por lotes: próximo lote (0 = nenhum lido) e total (null até o worker planejar) */
  lotes?: { atual: number; total: number | null } | undefined
  /** "Voltar às importações" (padrão: Importar → Cardápio) */
  voltar?: string
}) {
  const router = useRouter()
  const consultando = useRef(false)
  const porLotes = props.lotes !== undefined
  const [limiteInicial] = useState(() => (porLotes ? Date.now() : new Date(props.desde).getTime()) + LIMITE_LEITURA_MS)
  const limite = useRef(limiteInicial)
  const ultimoLote = useRef(props.lotes?.atual ?? 0)
  const [lotes, setLotes] = useState(props.lotes ?? null)
  const [falha, setFalha] = useState<string | null>(() => (LENDO.includes(props.status) && Date.now() >= limiteInicial ? DEMORANDO : null))
  const [descartar, setDescartar] = useState(false)
  const lendo = LENDO.includes(props.status) && falha === null

  useEffect(() => {
    if (!lendo) return
    let ativo = true
    const parar = (mensagem: string) => {
      clearInterval(t)
      if (ativo) setFalha(mensagem)
    }
    const t = setInterval(async () => {
      if (consultando.current) return
      if (Date.now() >= limite.current) return parar(DEMORANDO)
      consultando.current = true
      try {
        const r = await chamarAcao(() => estadoImportacaoAction(props.id))
        if (!ativo) return
        if (!r.ok) return parar(r.formError ?? 'Não foi possível acompanhar a leitura agora.')
        if (!r.data) return
        if (!LENDO.includes(r.data.status)) {
          clearInterval(t)
          router.refresh()
          return
        }
        const { loteAtual, lotesTotal } = r.data
        if (porLotes) {
          // lote novo lido: a leitura anda, o prazo recomeça
          if (loteAtual > ultimoLote.current) {
            ultimoLote.current = loteAtual
            limite.current = Date.now() + LIMITE_LEITURA_MS
          }
          setLotes({ atual: loteAtual, total: lotesTotal })
        }
      } finally {
        consultando.current = false
      }
    }, INTERVALO_MS)
    return () => {
      ativo = false
      clearInterval(t)
    }
  }, [lendo, porLotes, props.id, router])

  const executarDescarte = async () => {
    const r = await chamarAcao(() => descartarImportacaoAction(props.id))
    if (!r.ok) {
      toast.error(r.formError ?? 'Não foi possível descartar agora.')
      return
    }
    setDescartar(false)
    toast.success('Importação descartada')
    router.push(props.voltar ?? URL_IMPORTAR)
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      {lendo ? (
        <div role="status" className="flex items-center gap-3 text-foreground">
          <Loader2 aria-hidden="true" className="size-5 animate-spin" />
          <div>
            <p className="font-medium">{props.titulo ?? 'Lendo o cardápio…'}</p>
            {lotes?.total ? (
              <p className="text-sm text-foreground">Lendo {Math.min(lotes.atual + 1, lotes.total)} de {lotes.total}</p>
            ) : null}
            <p className="text-sm text-muted-foreground">
              {porLotes ? 'Os arquivos são lidos em partes. ' : 'Pode levar até um minuto. '}A revisão abre aqui quando terminar.
            </p>
          </div>
        </div>
      ) : (
        <p role="alert" className="text-sm text-destructive">
          {falha ?? props.erro ?? 'Não foi possível ler esse arquivo.'}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <Link href={props.voltar ?? URL_IMPORTAR} className="inline-flex min-h-11 items-center text-sm font-medium text-link underline-offset-4 hover:underline">
          {lendo ? 'Voltar às importações' : 'Enviar outro arquivo'}
        </Link>
        {props.status === 'erro' && <Button variant="outline" onClick={() => setDescartar(true)}>Descartar</Button>}
      </div>
      <Confirmar
        aberto={descartar}
        onAbertoChange={setDescartar}
        titulo="Descartar importação?"
        descricao="Ela sai da lista de importações para revisar. Você pode enviar o arquivo de novo depois."
        rotuloConfirmar="Descartar importação"
        rotuloAndamento="Descartando…"
        onConfirmar={executarDescarte}
      />
    </div>
  )
}
