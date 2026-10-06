import { z } from 'zod'
import { categoriaRascunhoSchema, itemRascunhoSchema, LIMITES_RASCUNHO } from '../s4/rascunho.ts'

/**
 * Rascunhos da importação por alvo (Etapa 07). A unidade é o nome lido no documento
 * (`string | null`); a DAL resolve para o id. Cada linha tem `incluir` (padrão true).
 * Limites iguais aos checks do banco quando existem.
 */
export const LIMITES_IMPORTACAO = {
  unidade: LIMITES_RASCUNHO.unidade,
  // informações (knowledge_facts)
  fatos: 100,
  tema: 120,
  texto: 1000,
  exemplos: 5,
  exemplo: 120,
  // horários (unit_hours / unit_hour_exceptions)
  unidadesHorario: 50,
  turnos: 6,
  excecoes: 100,
  motivo: 120,
  // espaços (event_spaces)
  espacos: 100,
  nomeEspaco: 80,
  capacidadeMin: 1,
  capacidadeMax: 1000,
  descricaoEspaco: 500,
  condicoes: 500,
  // cardápio e só preços
  itens: LIMITES_RASCUNHO.itens,
  categorias: LIMITES_RASCUNHO.categorias,
  precoConflito: 10,
} as const

const L = LIMITES_IMPORTACAO
const unidade = z.string().trim().min(1).max(L.unidade).nullable()
const incluir = z.boolean().default(true)
const preco = z.number().int().min(0).max(LIMITES_RASCUNHO.precoMax)

// ── Cardápio (completo): o rascunho da Etapa 05 + conflito de preço entre fotos ──

export const itemCardapioImportacaoSchema = itemRascunhoSchema.extend({
  /** preços diferentes lidos para o mesmo item (o primeiro é o `precoCentavos`) */
  precoConflito: z.array(preco).max(L.precoConflito).optional(),
})

export const rascunhoCardapioImportacaoSchema = z
  .object({
    categorias: z
      .array(categoriaRascunhoSchema.extend({ itens: z.array(itemCardapioImportacaoSchema).max(L.itens) }))
      .max(L.categorias),
  })
  .refine((r) => r.categorias.reduce((n, c) => n + c.itens.length, 0) <= L.itens, {
    message: `no máximo ${L.itens} itens`,
    path: ['categorias'],
  })

// ── Cardápio (só preços) ──

export const itemSoPrecosSchema = z.object({
  nome: z.string().trim().min(1).max(LIMITES_RASCUNHO.nome),
  categoria: z.string().trim().min(1).max(LIMITES_RASCUNHO.nome).nullable(),
  /** null = preço não lido; nunca zera o preço existente */
  precoCentavos: preco.nullable(),
  precoConflito: z.array(preco).max(L.precoConflito).optional(),
  incluir,
})

export const rascunhoSoPrecosSchema = z.object({ itens: z.array(itemSoPrecosSchema).max(L.itens) })

// ── Informações (knowledge_facts) ──

export const fatoRascunhoSchema = z.object({
  tema: z.string().trim().min(1).max(L.tema),
  texto: z.string().trim().min(1).max(L.texto),
  exemplos: z.array(z.string().trim().min(1).max(L.exemplo)).max(L.exemplos),
  unidade,
  incluir,
})

export const rascunhoInformacoesSchema = z.object({ fatos: z.array(fatoRascunhoSchema).max(L.fatos) })

// ── Horários ──

const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const DATA_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function dataIsoValida(s: string): boolean {
  const m = DATA_RE.exec(s)
  if (!m) return false
  const [a, me, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(a, me - 1, d))
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === me - 1 && dt.getUTCDate() === d
}

/** `fecha < abre` = vira a madrugada (permitido); `abre = fecha` não. */
export const turnoImportacaoSchema = z
  .object({ abre: z.string().regex(HORA_RE), fecha: z.string().regex(HORA_RE) })
  .refine((t) => t.abre !== t.fecha, { message: 'abre e fecha iguais', path: ['fecha'] })

export const diaHorarioSchema = z.object({
  dia: z.number().int().min(0).max(6),
  turnos: z.array(turnoImportacaoSchema).max(L.turnos),
  /** turnos sobrepostos ou demais na junção: a revisão pede conferência */
  conflito: z.boolean().default(false),
})

export const excecaoHorarioSchema = z
  .object({
    data: z.string().refine(dataIsoValida, { message: 'data inválida (AAAA-MM-DD)' }),
    fechado: z.boolean(),
    turnos: z.array(turnoImportacaoSchema).max(L.turnos),
    motivo: z.string().trim().min(1).max(L.motivo).nullable(),
    conflito: z.boolean().default(false),
  })
  .refine((e) => e.fechado === (e.turnos.length === 0), {
    message: 'fechado não tem turnos; aberto tem ao menos um',
    path: ['turnos'],
  })

const semRepetir = <T>(xs: readonly T[], chave: (x: T) => string | number) => new Set(xs.map(chave)).size === xs.length

export const unidadeHorarioSchema = z.object({
  unidade,
  semana: z.array(diaHorarioSchema).max(7).refine((ds) => semRepetir(ds, (d) => d.dia), { message: 'dia repetido' }),
  excecoes: z.array(excecaoHorarioSchema).max(L.excecoes).refine((es) => semRepetir(es, (e) => e.data), { message: 'data repetida' }),
  incluir,
})

export const rascunhoHorariosSchema = z.object({ unidades: z.array(unidadeHorarioSchema).max(L.unidadesHorario) })

// ── Espaços (event_spaces) ──

const capacidade = z.number().int().min(L.capacidadeMin).max(L.capacidadeMax)

export const espacoRascunhoSchema = z
  .object({
    nome: z.string().trim().min(1).max(L.nomeEspaco),
    unidade,
    capacidadeMin: capacidade,
    capacidadeMax: capacidade,
    descricao: z.string().trim().max(L.descricaoEspaco).nullable(),
    condicoes: z.string().trim().max(L.condicoes).nullable(),
    incluir,
  })
  .refine((e) => e.capacidadeMin <= e.capacidadeMax, { message: 'mínimo maior que o máximo', path: ['capacidadeMin'] })

export const rascunhoEspacosSchema = z.object({ espacos: z.array(espacoRascunhoSchema).max(L.espacos) })

export type RascunhoCardapioImportacao = z.infer<typeof rascunhoCardapioImportacaoSchema>
export type ItemCardapioImportacao = z.infer<typeof itemCardapioImportacaoSchema>
export type RascunhoSoPrecos = z.infer<typeof rascunhoSoPrecosSchema>
export type ItemSoPrecos = z.infer<typeof itemSoPrecosSchema>
export type RascunhoInformacoes = z.infer<typeof rascunhoInformacoesSchema>
export type FatoRascunho = z.infer<typeof fatoRascunhoSchema>
export type RascunhoHorarios = z.infer<typeof rascunhoHorariosSchema>
export type UnidadeHorarioRascunho = z.infer<typeof unidadeHorarioSchema>
export type DiaHorarioRascunho = z.infer<typeof diaHorarioSchema>
export type ExcecaoHorarioRascunho = z.infer<typeof excecaoHorarioSchema>
export type TurnoImportacao = z.infer<typeof turnoImportacaoSchema>
export type RascunhoEspacos = z.infer<typeof rascunhoEspacosSchema>
export type EspacoRascunho = z.infer<typeof espacoRascunhoSchema>
