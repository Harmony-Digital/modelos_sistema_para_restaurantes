'use client'
import { CheckCircle2, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { LIMITES_RASCUNHO, normalizeText, type RascunhoCardapio } from '@atd/core/s4'
import { aplicarRascunhoAction, descartarImportacaoAction } from '@/app/(painel)/conteudo/importar-actions'
import { Field, Select, TextInput } from '@/components/form'
import { MaskedInput } from '@/components/form/masked-input'
import { Confirmar } from '@/components/painel/confirmar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { chamarAcao } from '@/lib/action-result'
import { URL_IMPORTAR } from '@/lib/importacao'
import { formatarCentavos, maskReais, reaisParaCentavos } from '@/lib/dinheiro'
import { ROTULO_TAG, TAGS_CARDAPIO, type TagCardapio } from '@/lib/schemas/cardapio'
import { cn } from '@/lib/utils'

type ItemEdit = {
  nome: string
  descricao: string
  /** "R$ 12,50" (máscara); vazio = sob consulta */
  preco: string
  tags: string[]
  outrosNomes: string[]
  unidade: string | null
  incluir: boolean
}
type CategoriaEdit = { nome: string; itens: ItemEdit[] }
/** Item já cadastrado (para mostrar o que a importação muda nele). */
type ItemExistente = {
  categoria: string
  nome: string
  precoCentavos: number | null
  descricao: string | null
  tags: string[]
  outrosNomes: string[]
}
type Ignorado = { categoria: string; nome: string }
type Resultado = { criados: number; atualizados: number; ignorados: Ignorado[] }

const chave = (categoria: string, nome: string) => `${normalizeText(categoria)}|${normalizeText(nome)}`
const rotuloTag = (t: string) => ROTULO_TAG[t as TagCardapio] ?? t

function paraEdicao(r: RascunhoCardapio): CategoriaEdit[] {
  return r.categorias.map((c) => ({
    nome: c.nome,
    itens: c.itens.map((i) => ({
      nome: i.nome, descricao: i.descricao ?? '', preco: i.precoCentavos === null ? '' : formatarCentavos(i.precoCentavos),
      tags: i.tags, outrosNomes: i.outrosNomes, unidade: i.unidade, incluir: i.incluir,
    })),
  }))
}

function paraRascunho(cats: CategoriaEdit[]): RascunhoCardapio {
  return {
    categorias: cats.map((c) => ({
      nome: c.nome.trim(),
      itens: c.itens.map((i) => ({
        nome: i.nome.trim(), descricao: i.descricao.trim() || null, precoCentavos: reaisParaCentavos(i.preco),
        tags: i.tags, outrosNomes: i.outrosNomes, unidade: i.unidade, incluir: i.incluir,
      })),
    })),
  }
}

/** Mesmos limites do rascunhoSchema, com mensagem por campo. */
function errosDoItem(i: ItemEdit): { nome?: string; descricao?: string; preco?: string } {
  const e: { nome?: string; descricao?: string; preco?: string } = {}
  const nome = i.nome.trim()
  if (!nome) e.nome = 'Informe o nome'
  else if (nome.length > LIMITES_RASCUNHO.nome) e.nome = `Use no máximo ${LIMITES_RASCUNHO.nome} caracteres`
  if (i.descricao.trim().length > LIMITES_RASCUNHO.descricao) e.descricao = `Use no máximo ${LIMITES_RASCUNHO.descricao} caracteres`
  if ((reaisParaCentavos(i.preco) ?? 0) > LIMITES_RASCUNHO.precoMax) e.preco = 'O preço máximo é R$ 100.000,00'
  return e
}

function erroDaCategoria(nome: string): string | undefined {
  const n = nome.trim()
  if (!n) return 'Informe a categoria'
  if (n.length > LIMITES_RASCUNHO.nome) return `Use no máximo ${LIMITES_RASCUNHO.nome} caracteres`
  return undefined
}

const mesmoConjunto = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x))

/**
 * O que confirmar muda num item existente — mesma regra da aplicação no banco: só o que o rascunho traz (descrição,
 * etiquetas e outros nomes vazios e preço em branco mantêm o valor atual; preço de unidade não mexe no padrão).
 */
function mudancas(i: ItemEdit, atual: ItemExistente): string[] {
  const m: string[] = []
  const preco = reaisParaCentavos(i.preco)
  if (i.unidade === null && preco !== null && preco !== atual.precoCentavos) {
    m.push(`preço ${atual.precoCentavos === null ? 'sob consulta' : formatarCentavos(atual.precoCentavos)} → ${formatarCentavos(preco)}`)
  }
  const descricao = i.descricao.trim()
  if (descricao && descricao !== (atual.descricao ?? '')) m.push('descrição')
  if (i.tags.length && !mesmoConjunto(i.tags, atual.tags)) m.push('etiquetas')
  if (i.outrosNomes.length && !mesmoConjunto(i.outrosNomes, atual.outrosNomes)) m.push('outros nomes')
  return m
}

/**
 * Revisão do rascunho da importação (PRD I10: nada entra no cardápio sem esta confirmação). Cada item mostra se é
 * novo ou se atualiza um item existente (mesmo nome normalizado na mesma categoria, como faz a aplicação no banco) e,
 * nesse caso, o que muda. O nome da categoria é editável (juntar com uma categoria já cadastrada).
 */
export function RevisaoRascunho(props: {
  id: string
  origem: 'csv' | 'arquivo'
  rascunho: RascunhoCardapio
  categoriasExistentes: { nome: string; ativo: boolean }[]
  itensExistentes: ItemExistente[]
  /** unidades ativas (para o arquivo de envio) */
  unidades: { id: string; nome: string }[]
  /** dono, ou gerente com acesso a todas as unidades */
  podeAplicar: boolean
}) {
  const router = useRouter()
  const [cats, setCats] = useState(() => paraEdicao(props.rascunho))
  const [usarArquivo, setUsarArquivo] = useState(false)
  const [unitIdArquivo, setUnitIdArquivo] = useState('')
  const [mostrarErros, setMostrarErros] = useState(false)
  const [erroGeral, setErroGeral] = useState<string | undefined>()
  const [aplicando, setAplicando] = useState(false)
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const [descartar, setDescartar] = useState(false)
  // guarda síncrona: o duplo clique chega antes do re-render com o botão ocupado
  const emAndamento = useRef(false)

  const existentes = useMemo(() => new Map(props.itensExistentes.map((i) => [chave(i.categoria, i.nome), i])), [props.itensExistentes])
  const categoriasCadastradas = useMemo(() => new Set(props.categoriasExistentes.map((c) => normalizeText(c.nome))), [props.categoriasExistentes])
  const inativas = useMemo(
    () => new Set(props.categoriasExistentes.filter((c) => !c.ativo).map((c) => normalizeText(c.nome))),
    [props.categoriasExistentes],
  )
  const incluidos = cats.reduce((n, c) => n + c.itens.filter((i) => i.incluir).length, 0)
  const temErro = cats.some((c) => erroDaCategoria(c.nome) !== undefined || c.itens.some((i) => Object.keys(errosDoItem(i)).length > 0))

  const mudarCategoria = (ci: number, nome: string) => setCats((atual) => atual.map((c, x) => (x !== ci ? c : { ...c, nome })))
  const mudar = (ci: number, ii: number, m: Partial<ItemEdit>) =>
    setCats((atual) => atual.map((c, x) => (x !== ci ? c : { ...c, itens: c.itens.map((i, y) => (y !== ii ? i : { ...i, ...m })) })))

  const confirmar = async () => {
    if (emAndamento.current) return
    setErroGeral(undefined)
    if (temErro) {
      setMostrarErros(true)
      setErroGeral('Confira os itens marcados antes de confirmar.')
      return
    }
    emAndamento.current = true
    setAplicando(true)
    try {
      const r = await chamarAcao(() =>
        aplicarRascunhoAction(props.id, paraRascunho(cats), {
          usarComoArquivoDeEnvio: usarArquivo,
          unitIdArquivo: usarArquivo && unitIdArquivo !== '' ? unitIdArquivo : null,
        }),
      )
      if (!r.ok) {
        setErroGeral(r.formError ?? 'Não foi possível aplicar agora. Tente de novo.')
        return
      }
      if (!r.data) return
      toast.success(`Cardápio atualizado: ${r.data.criados} novos, ${r.data.atualizados} atualizados`)
      if (r.data.ignorados.length > 0) toast.warning(textoIgnorados(r.data.ignorados.length))
      setResultado(r.data)
    } finally {
      emAndamento.current = false
      setAplicando(false)
    }
  }

  const executarDescarte = async () => {
    const r = await chamarAcao(() => descartarImportacaoAction(props.id))
    if (!r.ok) {
      toast.error(r.formError ?? 'Não foi possível descartar agora.')
      return
    }
    setDescartar(false)
    toast.success('Importação descartada')
    router.push(URL_IMPORTAR)
  }

  if (resultado) return <ResultadoAplicacao r={resultado} />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">Revise antes de confirmar</h2>
        <p className="text-sm text-muted-foreground">
          {props.origem === 'arquivo'
            ? 'A IA leu o arquivo. Confira nomes e preços: o que estiver errado aqui chega aos clientes.'
            : 'Confira os itens lidos da planilha.'}{' '}
          Desmarque “Incluir” para deixar um item de fora.
        </p>
      </div>
      {cats.map((c, ci) => (
        <section key={ci} aria-label={`Categoria ${c.nome}`} className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-secondary/40 p-4">
            <Field
              id={`rev-cat-${ci}`}
              label="Categoria"
              hint="Para juntar com uma categoria já cadastrada, escreva o nome dela (aparece nas sugestões)."
              error={mostrarErros ? erroDaCategoria(c.nome) : undefined}
              required
            >
              {(a) => <TextInput {...a} list="rev-categorias" value={c.nome} onChange={(ev) => mudarCategoria(ci, ev.target.value)} />}
            </Field>
            {c.nome.trim() && (
              <Badge variant="outline" className="self-start">
                {categoriasCadastradas.has(normalizeText(c.nome)) ? 'Categoria existente' : 'Categoria nova'}
              </Badge>
            )}
          </div>
          {inativas.has(normalizeText(c.nome)) && (
            <p className="flex items-start gap-2 rounded-md border border-border bg-secondary p-3 text-sm text-foreground">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>A categoria {c.nome} está desativada: os itens não aparecerão para os clientes até reativá-la.</span>
            </p>
          )}
          <ul className="flex flex-col gap-3">
            {c.itens.map((i, ii) => {
              const e = mostrarErros ? errosDoItem(i) : {}
              const base = `rev-${ci}-${ii}`
              const atual = existentes.get(chave(c.nome, i.nome))
              const atualiza = atual !== undefined
              const muda = atual ? mudancas(i, atual) : []
              const tags = [...TAGS_CARDAPIO, ...i.tags.filter((t) => !(TAGS_CARDAPIO as readonly string[]).includes(t))]
              return (
                <li
                  key={ii}
                  role="group"
                  aria-label={i.nome.trim() || 'Item sem nome'}
                  className={cn('flex flex-col gap-3 rounded-lg border border-border bg-card p-4', !i.incluir && 'opacity-60')}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-foreground">
                      <input
                        type="checkbox"
                        className="size-5 accent-primary"
                        checked={i.incluir}
                        onChange={(ev) => mudar(ci, ii, { incluir: ev.target.checked })}
                      />
                      Incluir
                    </label>
                    {i.incluir && <Badge variant={atualiza ? 'secondary' : 'default'}>{atualiza ? 'Atualiza' : 'Novo'}</Badge>}
                  </div>
                  {i.unidade && <p className="text-sm text-muted-foreground">Preço só da unidade {i.unidade}</p>}
                  {i.incluir && atualiza && (
                    <p className="text-sm text-muted-foreground">
                      {muda.length ? `Muda: ${muda.join(', ')}` : 'Nada muda: campos em branco mantêm o valor atual.'}
                    </p>
                  )}
                  <Field id={`${base}-nome`} label="Nome" error={e.nome} required>
                    {(a) => <TextInput {...a} value={i.nome} onChange={(ev) => mudar(ci, ii, { nome: ev.target.value })} />}
                  </Field>
                  <Field
                    id={`${base}-preco`}
                    label="Preço"
                    hint={atualiza ? 'Em branco mantém o preço atual.' : 'Em branco = preço sob consulta.'}
                    error={e.preco}
                  >
                    {(a) => (
                      <MaskedInput {...a} mask={maskReais} placeholder="R$ 0,00" value={i.preco} onChange={(ev) => mudar(ci, ii, { preco: ev.target.value })} />
                    )}
                  </Field>
                  <Field id={`${base}-descricao`} label="Descrição" error={e.descricao}>
                    {(a) => <TextInput {...a} value={i.descricao} onChange={(ev) => mudar(ci, ii, { descricao: ev.target.value })} />}
                  </Field>
                  <fieldset className="flex flex-col gap-1.5">
                    <legend className="text-sm font-medium text-foreground">Etiquetas</legend>
                    <div className="flex flex-wrap gap-2">
                      {tags.map((t) => {
                        const marcada = i.tags.includes(t)
                        return (
                          <button
                            key={t}
                            type="button"
                            aria-pressed={marcada}
                            onClick={() => mudar(ci, ii, { tags: marcada ? i.tags.filter((x) => x !== t) : [...i.tags, t] })}
                            className={cn(
                              'min-h-11 rounded-full border px-4 text-sm font-medium transition-colors duration-150',
                              marcada ? 'border-transparent bg-primary text-primary-foreground' : 'border-border bg-card text-foreground',
                            )}
                          >
                            {rotuloTag(t)}
                          </button>
                        )
                      })}
                    </div>
                  </fieldset>
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      <datalist id="rev-categorias">
        {props.categoriasExistentes.map((c) => <option key={c.nome} value={c.nome} />)}
      </datalist>

      {props.origem === 'arquivo' && props.podeAplicar && (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
          <label className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-foreground">
            <input type="checkbox" className="size-5 accent-primary" checked={usarArquivo} onChange={(ev) => setUsarArquivo(ev.target.checked)} />
            Usar este arquivo como cardápio para enviar aos clientes
          </label>
          {usarArquivo && (
            <Field id="rev-unidade-arquivo" label="Vale para">
              {(a) => (
                <Select {...a} value={unitIdArquivo} onChange={(ev) => setUnitIdArquivo(ev.target.value)}>
                  <option value="">Todas as unidades</option>
                  {props.unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
                </Select>
              )}
            </Field>
          )}
        </div>
      )}

      {erroGeral && <p role="alert" className="text-sm text-destructive">{erroGeral}</p>}
      {!props.podeAplicar && (
        <p className="text-sm text-muted-foreground">
          Só o dono, ou gerente com acesso a todas as unidades, confirma a importação. Você pode revisar os itens ou descartá-la.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {props.podeAplicar && (
          <Button aria-busy={aplicando || undefined} disabled={aplicando || incluidos === 0} onClick={confirmar}>
            {aplicando ? 'Aplicando…' : 'Confirmar importação'}
          </Button>
        )}
        <Button variant="outline" disabled={aplicando} onClick={() => setDescartar(true)}>Descartar</Button>
      </div>
      <Confirmar
        aberto={descartar}
        onAbertoChange={setDescartar}
        titulo="Descartar importação?"
        descricao="Os itens lidos não entram no cardápio. Você pode importar de novo depois."
        rotuloConfirmar="Descartar importação"
        rotuloAndamento="Descartando…"
        onConfirmar={executarDescarte}
      />
    </div>
  )
}

const textoIgnorados = (n: number) =>
  n === 1 ? '1 item ignorado: unidade não encontrada' : `${n} itens ignorados: unidade não encontrada`

function ResultadoAplicacao({ r }: { r: Resultado }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <p role="status" className="flex items-center gap-2 font-semibold text-foreground">
        <CheckCircle2 aria-hidden="true" className="size-5" />
        Cardápio atualizado: {r.criados} novos, {r.atualizados} atualizados
      </p>
      {r.ignorados.length > 0 && (
        <div className="flex flex-col gap-1 text-sm text-foreground">
          <p className="font-medium">{textoIgnorados(r.ignorados.length)}</p>
          <p className="text-muted-foreground">Confira o nome da unidade na planilha ou cadastre o preço em “Por unidade”.</p>
          <ul className="list-disc pl-5">
            {r.ignorados.map((i) => <li key={`${i.categoria}|${i.nome}`}>{i.categoria} · {i.nome}</li>)}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-4">
        <Link href="/conteudo?aba=cardapio&sub=itens" className="inline-flex min-h-11 items-center text-sm font-medium text-link underline-offset-4 hover:underline">
          Ver os itens do cardápio
        </Link>
        <Link href={URL_IMPORTAR} className="inline-flex min-h-11 items-center text-sm font-medium text-link underline-offset-4 hover:underline">
          Nova importação
        </Link>
      </div>
    </div>
  )
}
