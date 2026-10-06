import { normalizeText } from '../normalize.ts'
import { minutosDe } from '../s1/horarios.ts'
import {
  LIMITES_IMPORTACAO as L,
  type DiaHorarioRascunho,
  type EspacoRascunho,
  type ExcecaoHorarioRascunho,
  type FatoRascunho,
  type ItemCardapioImportacao,
  type ItemSoPrecos,
  type RascunhoCardapioImportacao,
  type RascunhoEspacos,
  type RascunhoHorarios,
  type RascunhoInformacoes,
  type RascunhoSoPrecos,
  type TurnoImportacao,
  type UnidadeHorarioRascunho,
} from './rascunhos.ts'

/**
 * Junção dos rascunhos lidos em lotes (`juntar<Alvo>(acumulado, lote)`): pura, determinística e
 * idempotente (`juntar(a, a)` = `a`). O acumulado vem primeiro e prevalece; o lote só completa
 * campos vazios e acrescenta o que é novo, até os limites do alvo (o excedente é descartado).
 * Chaves por texto normalizado (sem acento, minúsculas, espaços colapsados).
 */

const chave = (s: string | null) => (s === null ? '' : normalizeText(s))

function unirTextos(a: readonly string[], b: readonly string[], max: number): string[] {
  const vistos = new Set<string>()
  const out: string[] = []
  for (const s of [...a, ...b]) {
    const k = chave(s)
    if (vistos.has(k) || out.length >= max) continue
    vistos.add(k)
    out.push(s)
  }
  return out
}

/** Une os preços lidos (o primeiro fica em `precoCentavos`); null nunca apaga um preço lido. */
function juntarPreco<T extends { precoCentavos: number | null; precoConflito?: number[] | undefined }>(x: T, y: T): T {
  const lidos = (i: T) => i.precoConflito ?? (i.precoCentavos === null ? [] : [i.precoCentavos])
  const precos = [...new Set([...lidos(x), ...lidos(y)])].slice(0, L.precoConflito)
  const r: T = { ...x, precoCentavos: x.precoCentavos ?? y.precoCentavos }
  if (precos.length > 1) r.precoConflito = precos
  else delete r.precoConflito
  return r
}

// ── Cardápio (completo) ──

function juntarItemCardapio(x: ItemCardapioImportacao, y: ItemCardapioImportacao): ItemCardapioImportacao {
  return {
    ...juntarPreco(x, y),
    descricao: x.descricao ?? y.descricao,
    tags: unirTextos(x.tags, y.tags, 10),
    outrosNomes: unirTextos(x.outrosNomes, y.outrosNomes, 10),
  }
}

/**
 * Categorias por nome; itens por nome + unidade em todo o cardápio (o mesmo prato lido sob
 * outra categoria noutra foto não duplica). Preços diferentes viram `precoConflito`.
 * Categorias sem itens não são criadas.
 */
export function juntarCardapio(
  acumulado: RascunhoCardapioImportacao | null,
  lote: RascunhoCardapioImportacao,
): RascunhoCardapioImportacao {
  const categorias: { nome: string; itens: ItemCardapioImportacao[] }[] = []
  const porCategoria = new Map<string, number>()
  const porItem = new Map<string, [number, number]>()
  let total = 0

  for (const cat of [...(acumulado?.categorias ?? []), ...lote.categorias]) {
    for (const item of cat.itens) {
      const ki = `${chave(item.nome)}|${chave(item.unidade)}`
      const pos = porItem.get(ki)
      if (pos) {
        const lista = categorias[pos[0]]!.itens
        lista[pos[1]] = juntarItemCardapio(lista[pos[1]]!, item)
        continue
      }
      if (total >= L.itens) continue
      const kc = chave(cat.nome)
      let ci = porCategoria.get(kc)
      if (ci === undefined) {
        if (categorias.length >= L.categorias) continue
        ci = categorias.push({ nome: cat.nome, itens: [] }) - 1
        porCategoria.set(kc, ci)
      }
      porItem.set(ki, [ci, categorias[ci]!.itens.push({ ...item }) - 1])
      total++
    }
  }
  return { categorias }
}

// ── Cardápio (só preços) ──

/** Itens por nome; preço não lido (null) nunca apaga o lido; preços diferentes viram conflito. */
export function juntarSoPrecos(acumulado: RascunhoSoPrecos | null, lote: RascunhoSoPrecos): RascunhoSoPrecos {
  const itens: ItemSoPrecos[] = []
  const pos = new Map<string, number>()
  for (const item of [...(acumulado?.itens ?? []), ...lote.itens]) {
    const k = chave(item.nome)
    const i = pos.get(k)
    if (i !== undefined) {
      const x = itens[i]!
      itens[i] = { ...juntarPreco(x, item), categoria: x.categoria ?? item.categoria }
    } else if (itens.length < L.itens) {
      pos.set(k, itens.push({ ...item }) - 1)
    }
  }
  return { itens }
}

// ── Informações ──

function juntarFato(x: FatoRascunho, y: FatoRascunho): FatoRascunho {
  const novo = chave(y.texto)
  const somado = `${x.texto}\n${y.texto}`
  const texto = chave(x.texto).includes(novo) || somado.length > L.texto ? x.texto : somado
  return { ...x, texto, exemplos: unirTextos(x.exemplos, y.exemplos, L.exemplos) }
}

/** Fatos por tema + unidade; texto novo é somado (até 1000), exemplos unidos (até 5). */
export function juntarInformacoes(acumulado: RascunhoInformacoes | null, lote: RascunhoInformacoes): RascunhoInformacoes {
  const fatos: FatoRascunho[] = []
  const pos = new Map<string, number>()
  for (const f of [...(acumulado?.fatos ?? []), ...lote.fatos]) {
    const k = `${chave(f.tema)}|${chave(f.unidade)}`
    const i = pos.get(k)
    if (i !== undefined) fatos[i] = juntarFato(fatos[i]!, f)
    else if (fatos.length < L.fatos) pos.set(k, fatos.push({ ...f, exemplos: [...f.exemplos] }) - 1)
  }
  return { fatos }
}

// ── Horários ──

/** Une, ordena por abertura e corta em 6; `conflito` se sobrepõe ou passou de 6. */
function juntarTurnos(a: readonly TurnoImportacao[], b: readonly TurnoImportacao[]): { turnos: TurnoImportacao[]; conflito: boolean } {
  const unicos = new Map<string, TurnoImportacao>()
  for (const t of [...a, ...b]) if (!unicos.has(`${t.abre}-${t.fecha}`)) unicos.set(`${t.abre}-${t.fecha}`, { ...t })
  const todos = [...unicos.values()].sort((p, q) => minutosDe(p.abre) - minutosDe(q.abre) || minutosDe(p.fecha) - minutosDe(q.fecha))
  let conflito = todos.length > L.turnos
  for (let i = 1; i < todos.length; i++) {
    const ant = todos[i - 1]!
    const fimAnt = minutosDe(ant.fecha) < minutosDe(ant.abre) ? minutosDe(ant.fecha) + 24 * 60 : minutosDe(ant.fecha)
    if (minutosDe(todos[i]!.abre) < fimAnt) conflito = true
  }
  return { turnos: todos.slice(0, L.turnos), conflito }
}

function juntarExcecao(x: ExcecaoHorarioRascunho, y: ExcecaoHorarioRascunho): ExcecaoHorarioRascunho {
  const motivo = x.motivo ?? y.motivo
  if (x.fechado !== y.fechado) return { ...x, motivo, conflito: true }
  if (x.fechado) return { ...x, motivo, conflito: x.conflito || y.conflito }
  const t = juntarTurnos(x.turnos, y.turnos)
  return { ...x, motivo, turnos: t.turnos, conflito: x.conflito || y.conflito || t.conflito }
}

function juntarUnidadeHorario(x: UnidadeHorarioRascunho, y: UnidadeHorarioRascunho): UnidadeHorarioRascunho {
  const dias = new Map<number, DiaHorarioRascunho>()
  for (const d of [...x.semana, ...y.semana]) {
    const atual = dias.get(d.dia) ?? { dia: d.dia, turnos: [], conflito: false }
    const t = juntarTurnos(atual.turnos, d.turnos)
    dias.set(d.dia, { dia: d.dia, turnos: t.turnos, conflito: atual.conflito || d.conflito || t.conflito })
  }
  const excecoes = new Map<string, ExcecaoHorarioRascunho>()
  for (const e of [...x.excecoes, ...y.excecoes]) {
    const atual = excecoes.get(e.data)
    if (atual) excecoes.set(e.data, juntarExcecao(atual, e))
    else if (excecoes.size < L.excecoes) excecoes.set(e.data, juntarExcecao(e, e))
  }
  return {
    ...x,
    semana: [...dias.values()].sort((p, q) => p.dia - q.dia),
    excecoes: [...excecoes.values()].sort((p, q) => p.data.localeCompare(q.data)),
  }
}

/**
 * Horários por unidade lida (nome normalizado; `null` = não reconhecida, juntas entre si) e dia.
 * Turnos ordenados, sem repetir; sobreposição marca `conflito` para a revisão.
 */
export function juntarHorarios(acumulado: RascunhoHorarios | null, lote: RascunhoHorarios): RascunhoHorarios {
  const unidades: UnidadeHorarioRascunho[] = []
  const pos = new Map<string, number>()
  for (const u of [...(acumulado?.unidades ?? []), ...lote.unidades]) {
    const k = u.unidade === null ? '\u0000' : chave(u.unidade)
    const i = pos.get(k)
    if (i !== undefined) unidades[i] = juntarUnidadeHorario(unidades[i]!, u)
    else if (unidades.length < L.unidadesHorario) {
      pos.set(k, unidades.push(juntarUnidadeHorario({ ...u, semana: [], excecoes: [] }, u)) - 1)
    }
  }
  return { unidades }
}

// ── Espaços ──

/** Espaços por nome + unidade; o primeiro prevalece e o lote só completa descrição e condições. */
export function juntarEspacos(acumulado: RascunhoEspacos | null, lote: RascunhoEspacos): RascunhoEspacos {
  const espacos: EspacoRascunho[] = []
  const pos = new Map<string, number>()
  for (const e of [...(acumulado?.espacos ?? []), ...lote.espacos]) {
    const k = `${chave(e.nome)}|${chave(e.unidade)}`
    const i = pos.get(k)
    if (i !== undefined) {
      const x = espacos[i]!
      espacos[i] = { ...x, descricao: x.descricao ?? e.descricao, condicoes: x.condicoes ?? e.condicoes }
    } else if (espacos.length < L.espacos) pos.set(k, espacos.push({ ...e }) - 1)
  }
  return { espacos }
}
