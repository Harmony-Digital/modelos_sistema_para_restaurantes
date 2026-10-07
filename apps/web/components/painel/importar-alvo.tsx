'use client'
import { FileUp, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { descartarImportacaoAction } from '@/app/(painel)/conteudo/importar-actions'
import {
  anexarArquivoAction, lerArquivosAction, novaImportacaoAction, removerArquivoAction,
} from '@/app/(painel)/conteudo/importar-alvo-actions'
import { Field } from '@/components/form'
import { classeArquivo, HistoricoImportacoes, ImportarCsv, tipoMime, type ImportacaoTela } from '@/components/painel/importar'
import { DescartarImportacao } from '@/components/painel/revisao-comum'
import { Button } from '@/components/ui/button'
import { chamarAcao } from '@/lib/action-result'
import { LIMITE_ARQUIVO_BYTES, LIMITE_ARQUIVO_MB, MENSAGEM_LIMITE } from '@/lib/arquivo-cardapio'
import { ALVOS_IMPORTACAO_TELA, urlImportacao, type AlvoImportacaoTela, type ModoImportacaoTela } from '@/lib/importacao'

const MAX_ARQUIVOS = 10
const ACEITOS = 'application/pdf,image/jpeg,image/png,image/webp'

const NOME_ALVO: Record<AlvoImportacaoTela, string> = {
  cardapio: 'cardápio',
  informacoes: 'informações',
  horarios: 'horários',
  espacos: 'espaços',
}

const tamanhoTexto = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`

/** Antes de qualquer requisição: quantidade e tamanho (o servidor confere de novo, com os bytes). */
function conferirArquivos(arquivos: File[], jaNaLista: number): string | null {
  if (arquivos.length === 0) return 'Escolha ao menos um arquivo.'
  if (jaNaLista + arquivos.length > MAX_ARQUIVOS) {
    return jaNaLista === 0 ? `Escolha no máximo ${MAX_ARQUIVOS} arquivos.` : `Cabem mais ${MAX_ARQUIVOS - jaNaLista} arquivos nesta importação.`
  }
  const grande = arquivos.find((a) => a.size > LIMITE_ARQUIVO_BYTES)
  return grande ? `${grande.name}: ${MENSAGEM_LIMITE}` : null
}

type Enviado = { nome: string; mime: string; tamanho: number; ordem: number; repetido: boolean }

/**
 * Falhas do envio inicial levadas para a tela da importação (recebendo arquivos), que as mostra uma vez. Só no
 * navegador desta aba; sem armazenamento (aba privada, bloqueio), as falhas só não aparecem lá.
 */
const chaveFalhas = (id: string) => `importacao-falhas:${id}`
function guardarFalhas(id: string, falhas: string[]) {
  try {
    sessionStorage.setItem(chaveFalhas(id), JSON.stringify(falhas))
  } catch {
    // sem armazenamento: segue sem a lista
  }
}
function tirarFalhas(id: string): string[] {
  try {
    const v = sessionStorage.getItem(chaveFalhas(id))
    sessionStorage.removeItem(chaveFalhas(id))
    const lista: unknown = v === null ? [] : JSON.parse(v)
    return Array.isArray(lista) ? lista.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** Lista de arquivos que não foram enviados (a chave é a posição: dois arquivos podem falhar com o mesmo texto). */
function ListaFalhas({ falhas }: { falhas: string[] }) {
  if (falhas.length === 0) return null
  return (
    <div role="alert" className="flex flex-col gap-1 rounded-md border border-destructive/40 p-3 text-sm text-destructive">
      <p className="font-medium">Alguns arquivos não foram enviados:</p>
      <ul className="list-disc pl-5">{falhas.map((f, i) => <li key={i} className="break-words">{f}</li>)}</ul>
    </div>
  )
}

/** Um arquivo por requisição, em ordem (a ordem da lista é a ordem de leitura). Falha num não para os outros. */
async function enviarArquivos(
  id: string,
  arquivos: File[],
  ordensAtuais: number[],
  progresso: (n: number) => void,
): Promise<{ enviados: Enviado[]; falhas: string[] }> {
  const enviados: Enviado[] = []
  const falhas: string[] = []
  const ordens = new Set(ordensAtuais)
  for (const [i, arquivo] of arquivos.entries()) {
    progresso(i + 1)
    const fd = new FormData()
    fd.set('arquivo', arquivo)
    const r = await chamarAcao(() => anexarArquivoAction(id, fd))
    if (!r.ok) {
      falhas.push(`${arquivo.name}: ${r.fieldErrors?.arquivo ?? r.formError ?? 'não foi enviado.'}`)
      continue
    }
    if (!r.data) continue
    const repetido = ordens.has(r.data.ordem)
    ordens.add(r.data.ordem)
    enviados.push({ nome: arquivo.name, mime: arquivo.type, tamanho: arquivo.size, ordem: r.data.ordem, repetido })
  }
  return { enviados, falhas }
}

/**
 * Conteúdo → Importar de um alvo: nova importação (vários arquivos), planilha CSV (cardápio) e o histórico.
 * `restrito`: gerente restrito a unidades — só o cardápio (PDF/fotos e planilha), como na Etapa 05: ele envia e
 * revisa; quem confirma é o dono ou o gerente com acesso a todas as unidades.
 */
export function ImportarAlvo(props: { alvo: AlvoImportacaoTela; importacoes: ImportacaoTela[]; restrito?: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Nada muda no cadastro sem a sua revisão: depois de ler os arquivos, você confere o que foi lido e confirma.
      </p>
      {props.restrito && (
        <p className="text-sm text-muted-foreground">
          Você envia e revisa; quem confirma é o dono ou gerente com acesso a todas as unidades. Informações, horários e espaços
          são importados por eles.
        </p>
      )}
      <NovaImportacao key={props.alvo} alvo={props.alvo} />
      {props.alvo === 'cardapio' && <ImportarCsv />}
      <HistoricoImportacoes alvo={props.alvo} importacoes={props.importacoes} vazio={`Nenhuma importação de ${NOME_ALVO[props.alvo]} ainda.`} />
    </div>
  )
}

function NovaImportacao(props: { alvo: AlvoImportacaoTela }) {
  const router = useRouter()
  const entrada = useRef<HTMLInputElement>(null)
  const emAndamento = useRef(false)
  const [modo, setModo] = useState<ModoImportacaoTela>('completo')
  const [enviando, setEnviando] = useState<string | null>(null)
  const [erro, setErro] = useState<string | undefined>()
  const [falhas, setFalhas] = useState<string[]>([])
  const descricao = ALVOS_IMPORTACAO_TELA.find((a) => a.chave === props.alvo)?.descricao

  const enviar = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (emAndamento.current) return
    const arquivos = Array.from(entrada.current?.files ?? [])
    const problema = conferirArquivos(arquivos, 0)
    setFalhas([])
    if (problema) return setErro(problema)
    emAndamento.current = true
    setErro(undefined)
    setEnviando('Preparando…')
    try {
      const r = await chamarAcao(() => novaImportacaoAction({ alvo: props.alvo, modo: props.alvo === 'cardapio' ? modo : 'completo' }))
      if (!r.ok) return setErro(r.formError ?? 'Não foi possível começar a importação agora.')
      if (!r.data) return
      const id = r.data.id
      const enviados = await enviarArquivos(id, arquivos, [], (n) => setEnviando(`Enviando ${n} de ${arquivos.length}…`))
      if (enviados.enviados.length === 0) {
        // nada entrou: a importação vazia não fica no histórico; as falhas ficam aqui
        await chamarAcao(() => descartarImportacaoAction(id))
        setFalhas(enviados.falhas)
        return
      }
      if (enviados.falhas.length > 0) guardarFalhas(id, enviados.falhas)
      router.push(urlImportacao(id, props.alvo))
    } finally {
      emAndamento.current = false
      setEnviando(null)
    }
  }

  return (
    <form noValidate onSubmit={enviar} className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
        <FileUp aria-hidden="true" className="size-5" /> PDF ou fotos
      </h2>
      {descricao && <p className="text-sm text-muted-foreground">{descricao} A IA lê os arquivos e monta uma lista para você revisar.</p>}
      {props.alvo === 'cardapio' && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-foreground">O que atualizar</legend>
          {([
            ['completo', 'Completo', 'Categorias, itens, descrições e preços.'],
            ['so_precos', 'Só preços', 'Só muda o preço de itens que já existem. Itens novos ficam de fora.'],
          ] as const).map(([valor, rotulo, ajuda]) => (
            <label key={valor} className="flex min-h-11 items-start gap-3 rounded-md border border-border p-3 text-sm text-foreground">
              <input
                type="radio"
                name="modo-importacao"
                value={valor}
                checked={modo === valor}
                onChange={() => setModo(valor)}
                className="mt-0.5 size-5 accent-primary"
              />
              <span className="min-w-0">
                <span className="block font-medium">{rotulo}</span>
                <span className="block text-muted-foreground">{ajuda}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <Field
        id="importar-arquivos"
        label="Arquivos"
        hint={`Até ${MAX_ARQUIVOS} arquivos: PDF, JPEG, PNG ou WebP, até ${LIMITE_ARQUIVO_MB} MB cada. Você pode tirar ou pôr arquivos antes de ler.`}
        error={erro}
        required
      >
        {(a) => <input {...a} ref={entrada} type="file" multiple accept={ACEITOS} className={classeArquivo} />}
      </Field>
      <ListaFalhas falhas={falhas} />
      <Button type="submit" aria-busy={enviando !== null || undefined} disabled={enviando !== null} className="self-start">
        {enviando ?? 'Enviar arquivos'}
      </Button>
    </form>
  )
}

type ArquivoLista = { ordem: number; mime: string; tamanho: number; nome: string | null }

/**
 * Importação recebendo arquivos (antes de "Ler arquivos"): lista em ordem de leitura, remover, adicionar mais (até
 * 10) e iniciar a leitura.
 */
export function ArquivosImportacao(props: {
  id: string
  alvo: AlvoImportacaoTela
  modo: ModoImportacaoTela
  arquivos: { ordem: number; mime: string; tamanho: number }[]
}) {
  const router = useRouter()
  const entrada = useRef<HTMLInputElement>(null)
  const emAndamento = useRef(false)
  const [lista, setLista] = useState<ArquivoLista[]>(() => props.arquivos.map((a) => ({ ...a, nome: null })))
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [erro, setErro] = useState<string | undefined>()
  const [falhas, setFalhas] = useState<string[]>([])
  // falhas do envio inicial (antes de abrir esta tela)
  useEffect(() => {
    const anteriores = tirarFalhas(props.id)
    if (anteriores.length > 0) setFalhas(anteriores)
  }, [props.id])
  const cheia = lista.length >= MAX_ARQUIVOS
  const rotulo = (a: ArquivoLista) => a.nome ?? `Arquivo ${a.ordem}`

  const exclusivo = async (texto: string, fn: () => Promise<void>) => {
    if (emAndamento.current) return
    emAndamento.current = true
    setOcupado(texto)
    setErro(undefined)
    try {
      await fn()
    } finally {
      emAndamento.current = false
      setOcupado(null)
    }
  }

  const adicionar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const arquivos = Array.from(e.target.files ?? [])
    if (arquivos.length === 0) return
    const problema = conferirArquivos(arquivos, lista.length)
    if (problema) {
      setErro(problema)
      if (entrada.current) entrada.current.value = ''
      return
    }
    void exclusivo('Enviando…', async () => {
      setFalhas([])
      const r = await enviarArquivos(props.id, arquivos, lista.map((a) => a.ordem), (n) => setOcupado(`Enviando ${n} de ${arquivos.length}…`))
      const novos = r.enviados.filter((a) => !a.repetido)
      for (const a of r.enviados.filter((x) => x.repetido)) toast.info(`${a.nome} já está na lista.`)
      setLista((atual) => [...atual, ...novos.map(({ ordem, mime, tamanho, nome }) => ({ ordem, mime, tamanho, nome }))].sort((x, y) => x.ordem - y.ordem))
      setFalhas(r.falhas)
      if (entrada.current) entrada.current.value = ''
    })
  }

  const remover = (a: ArquivoLista) =>
    exclusivo('Removendo…', async () => {
      const r = await chamarAcao(() => removerArquivoAction(props.id, a.ordem))
      if (!r.ok) return setErro(r.formError ?? 'Não foi possível remover agora.')
      // o banco renumera: quem vinha depois sobe uma posição
      setLista((atual) => atual.filter((x) => x.ordem !== a.ordem).map((x) => (x.ordem > a.ordem ? { ...x, ordem: x.ordem - 1 } : x)))
    })

  const ler = () =>
    exclusivo('Começando a leitura…', async () => {
      const r = await chamarAcao(() => lerArquivosAction(props.id))
      if (!r.ok) return setErro(r.formError ?? 'Não foi possível começar a leitura agora.')
      if (!r.data) return
      if (r.data.existente) {
        // esta (ainda recebendo arquivos) não fica órfã no histórico
        await chamarAcao(() => descartarImportacaoAction(props.id))
        toast.info('Esses arquivos já foram importados. Mostrando a importação deles.')
        router.push(urlImportacao(r.data.id, props.alvo))
        return
      }
      router.refresh()
    })

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">
          Importação de {NOME_ALVO[props.alvo]}{props.modo === 'so_precos' ? ' (só preços)' : ''}
        </h2>
        <p className="text-sm text-muted-foreground">A ordem da lista é a ordem de leitura. Confira os arquivos e toque em “Ler arquivos”.</p>
      </div>
      {lista.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum arquivo ainda. Adicione PDF ou fotos para ler.</p>
      ) : (
        <ol aria-label="Arquivos para ler" className="flex flex-col gap-2">
          {lista.map((a) => (
            <li key={a.ordem} className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">{rotulo(a)}</p>
                <p className="text-sm text-muted-foreground">{tipoMime(a.mime)} · {tamanhoTexto(a.tamanho)}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remover ${rotulo(a)} (${tipoMime(a.mime)})`}
                disabled={ocupado !== null}
                onClick={() => void remover(a)}
                className="size-11 shrink-0"
              >
                <Trash2 aria-hidden="true" className="size-4" />
              </Button>
            </li>
          ))}
        </ol>
      )}
      <ListaFalhas falhas={falhas} />
      <Field
        id="importar-mais-arquivos"
        label="Adicionar arquivos"
        hint={cheia ? `Limite de ${MAX_ARQUIVOS} arquivos atingido.` : `PDF, JPEG, PNG ou WebP, até ${LIMITE_ARQUIVO_MB} MB cada.`}
        error={erro}
      >
        {(a) => (
          <input {...a} ref={entrada} type="file" multiple accept={ACEITOS} disabled={cheia || ocupado !== null} onChange={adicionar} className={classeArquivo} />
        )}
      </Field>
      {ocupado && <p role="status" className="text-sm text-muted-foreground">{ocupado}</p>}
      <div className="flex flex-wrap gap-2">
        <Button aria-busy={ocupado !== null || undefined} disabled={lista.length === 0 || ocupado !== null} onClick={() => void ler()}>
          Ler arquivos
        </Button>
        <DescartarImportacao alvo={props.alvo} id={props.id} disabled={ocupado !== null} />
      </div>
    </div>
  )
}
