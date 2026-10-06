'use client'
import { TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { LIMITES_IMPORTACAO, type RascunhoEspacos, type RascunhoInformacoes, type RascunhoSoPrecos } from '@atd/core/importacao'
import { LIMITES_RASCUNHO, normalizeText } from '@atd/core/s4'
import { Field, Select, TextInput, Textarea } from '@/components/form'
import { MaskedInput } from '@/components/form/masked-input'
import {
  AcoesRevisao, AvisoConflitoPreco, ResultadoImportacao, Resumo, useConfirmarImportacao, type UnidadeOpcao,
} from '@/components/painel/revisao-comum'
import { Badge } from '@/components/ui/badge'
import { formatarCentavos, maskReais, reaisParaCentavos } from '@/lib/dinheiro'
import { cn } from '@/lib/utils'

export { RevisaoHorarios } from '@/components/painel/revisao-horarios'

/**
 * Revisão por alvo (Etapa 07, PRD I10): só preços, informações e espaços. O rascunho editado vai inteiro para
 * `aplicarImportacaoAction` (validado pelo schema do alvo no servidor e no banco). Rótulos novo/atualizar vêm da DAL.
 */

const L = LIMITES_IMPORTACAO
const classeItem = (incluir: boolean) => cn('flex flex-col gap-3 rounded-lg border border-border bg-card p-4', !incluir && 'opacity-60')

function CaixaIncluir(props: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-foreground">
      <input type="checkbox" className="size-5 accent-primary" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      Incluir
    </label>
  )
}

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-md border border-border bg-secondary p-3 text-sm text-foreground">
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  )
}

const ERRO_CAMPOS = 'Confira os campos marcados antes de confirmar.'

// ───────────────────────────── só preços ─────────────────────────────

type MotivoFora = 'desmarcado' | 'sem_preco' | 'nao_encontrado' | 'ambiguo' | 'sem_mudanca'
const MOTIVO_FORA: Record<MotivoFora, string> = {
  nao_encontrado: 'não está no cardápio (itens novos não entram em “só preços”)',
  sem_preco: 'preço não lido (o atual fica)',
  ambiguo: 'nome em mais de uma categoria: ajuste à mão no cardápio',
  sem_mudanca: 'preço igual ao atual',
  desmarcado: 'desmarcado',
}

export function RevisaoSoPrecos(props: {
  id: string
  rascunho: RascunhoSoPrecos
  mudancas: { indice: number; itemId: string; nome: string; categoria: string; antes: number | null; depois: number }[]
  ignorados: { indice: number; nome: string; motivo: MotivoFora }[]
  podeAplicar: boolean
}) {
  const c = useConfirmarImportacao({ id: props.id, alvo: 'cardapio', modo: 'so_precos' })
  // edição só das linhas que mudam: preço (máscara) e incluir
  const [edits, setEdits] = useState(() =>
    new Map(props.mudancas.map((m) => [m.indice, { preco: formatarCentavos(props.rascunho.itens[m.indice]?.precoCentavos ?? m.depois), incluir: true }])),
  )
  const [mostrarErros, setMostrarErros] = useState(false)
  const mudar = (indice: number, m: Partial<{ preco: string; incluir: boolean }>) =>
    setEdits((atual) => new Map(atual).set(indice, { ...atual.get(indice)!, ...m }))
  const erroPreco = (preco: string) => ((reaisParaCentavos(preco) ?? 0) > LIMITES_RASCUNHO.precoMax ? 'O preço máximo é R$ 100.000,00' : undefined)
  const incluidos = [...edits.values()].filter((e) => e.incluir).length

  const montar = () => {
    if ([...edits.values()].some((e) => erroPreco(e.preco))) {
      setMostrarErros(true)
      c.setErroGeral(ERRO_CAMPOS)
      return null
    }
    return {
      itens: props.rascunho.itens.map((i, indice) => {
        const e = edits.get(indice)
        return e ? { ...i, precoCentavos: reaisParaCentavos(e.preco), incluir: e.incluir } : i
      }),
    }
  }

  if (c.resultado) return <ResultadoImportacao alvo="cardapio" modo="so_precos" r={c.resultado} />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">Revise os preços antes de confirmar</h2>
        <p className="text-sm text-muted-foreground">
          Só muda o preço de itens que já estão no cardápio. Confira cada valor: o que estiver aqui chega aos clientes.
        </p>
        <Resumo partes={[[incluidos, 'preço muda', 'preços mudam'], [props.ignorados.length, 'fica de fora', 'ficam de fora']]} />
      </div>
      {props.mudancas.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          Nenhum preço muda: os itens lidos não estão no cardápio ou já têm esse preço. Para cadastrar itens novos, importe no modo “Completo”.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {props.mudancas.map((m) => {
            const e = edits.get(m.indice)!
            const novo = reaisParaCentavos(e.preco)
            const conflito = props.rascunho.itens[m.indice]?.precoConflito ?? []
            return (
              <li key={m.indice} role="group" aria-label={m.nome} className={classeItem(e.incluir)}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CaixaIncluir checked={e.incluir} onChange={(v) => mudar(m.indice, { incluir: v })} />
                  <span className="text-sm text-muted-foreground">{m.categoria}</span>
                </div>
                <p className="font-medium text-foreground">{m.nome}</p>
                <p className="text-sm text-foreground">
                  {m.antes === null ? 'sob consulta' : formatarCentavos(m.antes)} → {novo === null ? 'mantém o atual' : formatarCentavos(novo)}
                </p>
                <AvisoConflitoPreco precos={conflito} />
                <Field id={`sp-${m.indice}-preco`} label="Novo preço" hint="Em branco mantém o preço atual." error={mostrarErros ? erroPreco(e.preco) : undefined}>
                  {(a) => <MaskedInput {...a} mask={maskReais} placeholder="R$ 0,00" value={e.preco} onChange={(ev) => mudar(m.indice, { preco: ev.target.value })} />}
                </Field>
              </li>
            )
          })}
        </ul>
      )}
      {props.ignorados.length > 0 && (
        <section aria-label="Ficam de fora" className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold text-foreground">Ficam de fora</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {props.ignorados.map((i) => (
              <li key={i.indice} className="flex min-w-0 flex-wrap gap-x-2">
                <span className="font-medium text-foreground">{i.nome}</span>
                <span className="text-muted-foreground">{MOTIVO_FORA[i.motivo]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <AcoesRevisao
        alvo="cardapio"
        id={props.id}
        podeAplicar={props.podeAplicar}
        aplicando={c.aplicando}
        erroGeral={c.erroGeral}
        semIncluidos={incluidos === 0}
        onConfirmar={() => void c.confirmar(montar)}
      />
    </div>
  )
}

// ───────────────────────────── informações ─────────────────────────────

type RotuloFato = { acao: 'novo' | 'atualizar' | 'ignorar' | 'unidade_desconhecida'; factId: string | null; unitId: string | null }
type FatoEdit = { tema: string; texto: string; exemplos: string[]; unidade: string; incluir: boolean }

/** Valor do seletor de unidade: '' = todas as unidades; nome canônico da unidade; ou o nome lido (não reconhecido). */
function valorUnidadeInicial(lida: string | null, unitId: string | null, unidades: UnidadeOpcao[]): string {
  if (lida === null) return ''
  return unidades.find((u) => u.id === unitId)?.nome ?? lida
}

export function RevisaoInformacoes(props: {
  id: string
  rascunho: RascunhoInformacoes
  rotulos: RotuloFato[]
  unidades: UnidadeOpcao[]
  /** fatos já cadastrados (para recalcular Novo/Atualiza ao trocar tema ou unidade) */
  fatosExistentes: { tema: string; unitId: string | null }[]
  podeAplicar: boolean
}) {
  const c = useConfirmarImportacao({ id: props.id, alvo: 'informacoes', modo: 'completo' })
  const [fatos, setFatos] = useState<FatoEdit[]>(() =>
    props.rascunho.fatos.map((f, i) => ({
      tema: f.tema, texto: f.texto, exemplos: f.exemplos, incluir: f.incluir,
      unidade: valorUnidadeInicial(f.unidade, props.rotulos[i]?.acao === 'unidade_desconhecida' ? null : (props.rotulos[i]?.unitId ?? null), props.unidades),
    })),
  )
  const [mostrarErros, setMostrarErros] = useState(false)
  const mudar = (i: number, m: Partial<FatoEdit>) => setFatos((atual) => atual.map((f, x) => (x === i ? { ...f, ...m } : f)))

  /** undefined = unidade não reconhecida (o fato fica de fora) */
  const unitIdDe = (i: number, valor: string): string | null | undefined => {
    if (valor === '') return null
    const porNome = props.unidades.find((u) => u.nome === valor)
    if (porNome) return porNome.id
    const r = props.rotulos[i]
    return valor === props.rascunho.fatos[i]?.unidade && r && r.acao !== 'unidade_desconhecida' && r.unitId !== null ? r.unitId : undefined
  }
  const acaoDe = (i: number, f: FatoEdit): 'novo' | 'atualizar' | 'desconhecida' => {
    const unitId = unitIdDe(i, f.unidade)
    if (unitId === undefined) return 'desconhecida'
    const tema = normalizeText(f.tema)
    return props.fatosExistentes.some((e) => e.unitId === unitId && normalizeText(e.tema) === tema) ? 'atualizar' : 'novo'
  }
  const erros = (f: FatoEdit) => {
    const e: { tema?: string; texto?: string } = {}
    if (!f.tema.trim()) e.tema = 'Informe o tema'
    else if (f.tema.trim().length > L.tema) e.tema = `Use no máximo ${L.tema} caracteres`
    if (!f.texto.trim()) e.texto = 'Escreva a resposta'
    else if (f.texto.trim().length > L.texto) e.texto = `Use no máximo ${L.texto} caracteres`
    return e
  }
  const acoes = fatos.map((f, i) => (f.incluir ? acaoDe(i, f) : null))
  const conta = (a: string) => acoes.filter((x) => x === a).length

  const montar = (): RascunhoInformacoes | null => {
    if (fatos.some((f) => f.incluir && Object.keys(erros(f)).length > 0)) {
      setMostrarErros(true)
      c.setErroGeral(ERRO_CAMPOS)
      return null
    }
    return {
      fatos: fatos.map((f) => ({ tema: f.tema.trim(), texto: f.texto.trim(), exemplos: f.exemplos, unidade: f.unidade === '' ? null : f.unidade, incluir: f.incluir })),
    }
  }

  if (c.resultado) return <ResultadoImportacao alvo="informacoes" modo="completo" r={c.resultado} />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">Revise as informações antes de confirmar</h2>
        <p className="text-sm text-muted-foreground">
          A IA responde aos clientes com estes textos. Corrija o que estiver errado e desmarque “Incluir” para deixar algo de fora.
        </p>
        <Resumo partes={[[conta('novo'), 'novo', 'novos'], [conta('atualizar'), 'para atualizar', 'para atualizar'], [conta('desconhecida'), 'com unidade não encontrada', 'com unidade não encontrada']]} />
      </div>
      <ul className="flex flex-col gap-3">
        {fatos.map((f, i) => {
          const e = mostrarErros && f.incluir ? erros(f) : {}
          const acao = acoes[i]
          const lida = props.rascunho.fatos[i]?.unidade ?? null
          const extra = f.unidade !== '' && !props.unidades.some((u) => u.nome === f.unidade) ? f.unidade : null
          const extraOriginal = lida !== null && !props.unidades.some((u) => u.nome === lida) && unitIdDe(i, lida) === undefined ? lida : null
          return (
            <li key={i} role="group" aria-label={f.tema.trim() || 'Informação sem tema'} className={classeItem(f.incluir)}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CaixaIncluir checked={f.incluir} onChange={(v) => mudar(i, { incluir: v })} />
                {acao === 'novo' && <Badge>Novo</Badge>}
                {acao === 'atualizar' && <Badge variant="secondary">Atualiza</Badge>}
              </div>
              {acao === 'desconhecida' && <Aviso>Unidade “{f.unidade}” não encontrada: escolha uma unidade ou este item fica de fora.</Aviso>}
              <Field id={`inf-${i}-tema`} label="Tema" error={e.tema} required>
                {(a) => <TextInput {...a} value={f.tema} onChange={(ev) => mudar(i, { tema: ev.target.value })} />}
              </Field>
              <Field id={`inf-${i}-texto`} label="Texto" error={e.texto} required>
                {(a) => <Textarea {...a} value={f.texto} onChange={(ev) => mudar(i, { texto: ev.target.value })} />}
              </Field>
              {f.exemplos.length > 0 && (
                <p className="text-sm text-muted-foreground">Perguntas de exemplo: {f.exemplos.join('; ')}</p>
              )}
              <Field id={`inf-${i}-unidade`} label="Unidade">
                {(a) => (
                  <Select {...a} value={f.unidade} onChange={(ev) => mudar(i, { unidade: ev.target.value })}>
                    <option value="">Todas as unidades</option>
                    {props.unidades.map((u) => <option key={u.id} value={u.nome}>{u.nome}</option>)}
                    {[...new Set([extra, extraOriginal].filter((x): x is string => x !== null))].map((x) => (
                      <option key={`lida-${x}`} value={x}>{unitIdDe(i, x) === undefined ? `${x} (não encontrada)` : x}</option>
                    ))}
                  </Select>
                )}
              </Field>
            </li>
          )
        })}
      </ul>
      <AcoesRevisao
        alvo="informacoes"
        id={props.id}
        podeAplicar={props.podeAplicar}
        aplicando={c.aplicando}
        erroGeral={c.erroGeral}
        semIncluidos={!fatos.some((f) => f.incluir)}
        onConfirmar={() => void c.confirmar(montar)}
      />
    </div>
  )
}

// ───────────────────────────── espaços ─────────────────────────────

type RotuloEspaco = { acao: 'novo' | 'atualizar' | 'ignorar' | 'escolher_unidade'; unitId: string | null; spaceId: string | null }
type EspacoEdit = { nome: string; min: string; max: string; descricao: string; condicoes: string; incluir: boolean; escolha: string }
const FORA = '__fora'
const numero = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN)

export function RevisaoEspacos(props: {
  id: string
  rascunho: RascunhoEspacos
  rotulos: RotuloEspaco[]
  unidades: UnidadeOpcao[]
  podeAplicar: boolean
}) {
  const c = useConfirmarImportacao({ id: props.id, alvo: 'espacos', modo: 'completo' })
  const precisaEscolher = (i: number) => (props.rotulos[i]?.unitId ?? null) === null
  const [espacos, setEspacos] = useState<EspacoEdit[]>(() =>
    props.rascunho.espacos.map((e, i) => ({
      nome: e.nome, min: String(e.capacidadeMin), max: String(e.capacidadeMax), descricao: e.descricao ?? '', condicoes: e.condicoes ?? '',
      incluir: e.incluir, escolha: precisaEscolher(i) && !e.incluir ? FORA : '',
    })),
  )
  const [mostrarErros, setMostrarErros] = useState(false)
  const mudar = (i: number, m: Partial<EspacoEdit>) => setEspacos((atual) => atual.map((e, x) => (x === i ? { ...e, ...m } : e)))
  const incluido = (i: number, e: EspacoEdit) => (precisaEscolher(i) ? e.escolha !== FORA : e.incluir)

  const erros = (i: number, e: EspacoEdit) => {
    const r: { nome?: string; min?: string; max?: string; descricao?: string; condicoes?: string; unidade?: string } = {}
    if (!e.nome.trim()) r.nome = 'Informe o nome'
    else if (e.nome.trim().length > L.nomeEspaco) r.nome = `Use no máximo ${L.nomeEspaco} caracteres`
    const [min, max] = [numero(e.min), numero(e.max)]
    const fora = (n: number) => !Number.isInteger(n) || n < L.capacidadeMin || n > L.capacidadeMax
    if (fora(min)) r.min = `Use um número de ${L.capacidadeMin} a ${L.capacidadeMax}`
    if (fora(max)) r.max = `Use um número de ${L.capacidadeMin} a ${L.capacidadeMax}`
    if (!r.min && !r.max && min > max) r.min = 'O mínimo passa do máximo'
    if (e.descricao.trim().length > L.descricaoEspaco) r.descricao = `Use no máximo ${L.descricaoEspaco} caracteres`
    if (e.condicoes.trim().length > L.condicoes) r.condicoes = `Use no máximo ${L.condicoes} caracteres`
    if (precisaEscolher(i) && e.escolha === '') r.unidade = 'Escolha a unidade ou deixe este espaço de fora.'
    return r
  }

  const grupos = new Map<string, number[]>()
  props.rascunho.espacos.forEach((e, i) => {
    const titulo = precisaEscolher(i)
      ? 'Espaços sem unidade reconhecida'
      : `Espaços de ${props.unidades.find((u) => u.id === props.rotulos[i]?.unitId)?.nome ?? e.unidade ?? ''}`
    grupos.set(titulo, [...(grupos.get(titulo) ?? []), i])
  })
  const contar = (a: RotuloEspaco['acao']) => espacos.filter((e, i) => incluido(i, e) && props.rotulos[i]?.acao === a).length

  const montar = (): RascunhoEspacos | null => {
    if (espacos.some((e, i) => incluido(i, e) && Object.keys(erros(i, e)).length > 0)) {
      setMostrarErros(true)
      c.setErroGeral(ERRO_CAMPOS)
      return null
    }
    return {
      espacos: espacos.map((e, i) => {
        const orig = props.rascunho.espacos[i]!
        const inc = incluido(i, e)
        return {
          nome: e.nome.trim(),
          unidade: precisaEscolher(i) && e.escolha !== FORA && e.escolha !== '' ? e.escolha : orig.unidade,
          // fora do envio: mantém os números lidos (válidos pelo schema) para o rascunho passar inteiro
          capacidadeMin: inc ? numero(e.min) : orig.capacidadeMin,
          capacidadeMax: inc ? numero(e.max) : orig.capacidadeMax,
          descricao: e.descricao.trim() || null,
          condicoes: e.condicoes.trim() || null,
          incluir: inc,
        }
      }),
    }
  }

  if (c.resultado) return <ResultadoImportacao alvo="espacos" modo="completo" r={c.resultado} />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">Revise os espaços antes de confirmar</h2>
        <p className="text-sm text-muted-foreground">Confira nomes e capacidades de cada unidade. Desmarque “Incluir” para deixar um espaço de fora.</p>
        <Resumo partes={[[contar('novo'), 'novo', 'novos'], [contar('atualizar'), 'para atualizar', 'para atualizar'], [contar('escolher_unidade'), 'com unidade a escolher', 'com unidade a escolher']]} />
      </div>
      {[...grupos.entries()].map(([titulo, indices]) => (
        <section key={titulo} aria-label={titulo} className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-foreground">{titulo}</h3>
          <ul className="flex flex-col gap-3">
            {indices.map((i) => {
              const e = espacos[i]!
              const inc = incluido(i, e)
              const err = mostrarErros && (inc || e.escolha === '') ? erros(i, e) : {}
              const rot = props.rotulos[i]
              const nomeIgual = normalizeText(e.nome) === normalizeText(props.rascunho.espacos[i]!.nome)
              const base = `esp-${i}`
              return (
                <li key={i} role="group" aria-label={e.nome.trim() || 'Espaço sem nome'} className={classeItem(inc)}>
                  {precisaEscolher(i) ? (
                    <Field id={`${base}-unidade`} label="Unidade" error={err.unidade} required>
                      {(a) => (
                        <Select {...a} value={e.escolha} onChange={(ev) => mudar(i, { escolha: ev.target.value })}>
                          <option value="">Escolha a unidade…</option>
                          {props.unidades.map((u) => <option key={u.id} value={u.nome}>{u.nome}</option>)}
                          <option value={FORA}>Deixar de fora</option>
                        </Select>
                      )}
                    </Field>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CaixaIncluir checked={e.incluir} onChange={(v) => mudar(i, { incluir: v })} />
                      {inc && nomeIgual && rot?.acao === 'novo' && <Badge>Novo</Badge>}
                      {inc && nomeIgual && rot?.acao === 'atualizar' && <Badge variant="secondary">Atualiza</Badge>}
                    </div>
                  )}
                  {precisaEscolher(i) && props.rascunho.espacos[i]!.unidade && (
                    <p className="text-sm text-muted-foreground">Lido como “{props.rascunho.espacos[i]!.unidade}”, que não corresponde a nenhuma unidade.</p>
                  )}
                  <Field id={`${base}-nome`} label="Nome" error={err.nome} required>
                    {(a) => <TextInput {...a} value={e.nome} onChange={(ev) => mudar(i, { nome: ev.target.value })} />}
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field id={`${base}-min`} label="Capacidade mínima" error={err.min} required>
                      {(a) => <TextInput {...a} inputMode="numeric" value={e.min} onChange={(ev) => mudar(i, { min: ev.target.value })} />}
                    </Field>
                    <Field id={`${base}-max`} label="Capacidade máxima" error={err.max} required>
                      {(a) => <TextInput {...a} inputMode="numeric" value={e.max} onChange={(ev) => mudar(i, { max: ev.target.value })} />}
                    </Field>
                  </div>
                  <Field id={`${base}-descricao`} label="Descrição" hint="Em branco mantém a descrição atual." error={err.descricao}>
                    {(a) => <TextInput {...a} value={e.descricao} onChange={(ev) => mudar(i, { descricao: ev.target.value })} />}
                  </Field>
                  <Field id={`${base}-condicoes`} label="Condições" hint="Ex.: consumação mínima. Em branco mantém as atuais." error={err.condicoes}>
                    {(a) => <TextInput {...a} value={e.condicoes} onChange={(ev) => mudar(i, { condicoes: ev.target.value })} />}
                  </Field>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
      <AcoesRevisao
        alvo="espacos"
        id={props.id}
        podeAplicar={props.podeAplicar}
        aplicando={c.aplicando}
        erroGeral={c.erroGeral}
        semIncluidos={!espacos.some((e, i) => incluido(i, e))}
        onConfirmar={() => void c.confirmar(montar)}
      />
    </div>
  )
}
