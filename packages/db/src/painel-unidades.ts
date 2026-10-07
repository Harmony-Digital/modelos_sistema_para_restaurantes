import { and, asc, eq, gte, inArray } from 'drizzle-orm'
import { agoraLocal, normalizeText, type DataIso, type PoliticaFeriado, type Turno, type UnidadeS1 } from '@atd/core'
import type { Db } from './client.ts'
import { exigirPapel, falha, ok, registrarAuditoria, semPermissaoVira, type ResultadoPainel } from './painel-comum.ts'
import { withUserContext, type JwtClaims, type Tx } from './rls.ts'
import { montarUnidades } from './s1.ts'
import { restaurants, units } from './schema/restaurant.ts'
import { unitHourExceptions, unitHours } from './schema/s1.ts'

export type UnidadePainel = UnidadeS1 & { ativo: boolean; slug: string; cep: string | null; telefone: string | null }
export type RestaurantePainel = { id: string; nome: string; timezone: string; politicaFeriado: PoliticaFeriado; politicaUrl: string | null }
export type DadosUnidade = {
  nome: string
  endereco: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
  cep: string | null
  telefone: string | null
  apelidos: string[]
  mapsUrl: string | null
  lat: number | null
  lng: number | null
  ativo: boolean
  /** Lotação máxima de pessoas por dia (1..5000) ou null (sem controle). Omitida: não muda. */
  capacidadePessoas?: number | null
}
export const CAPACIDADE_MAXIMA = 5000
const capacidadeValida = (c: number | null | undefined) =>
  c === undefined || c === null || (Number.isInteger(c) && c >= 1 && c <= CAPACIDADE_MAXIMA)
export type ExcecaoInput = { data: DataIso; fechado: boolean; turnos: Turno[]; motivo: string | null }

const GESTAO = ['dono', 'gerente'] as const
const slugDe = (nome: string) => normalizeText(nome).replace(/ /g, '-').slice(0, 60) || 'unidade'

/** Unidades visíveis ao usuário (RLS por unidade), com agenda e exceções do ano corrente em diante. */
export function carregarUnidadesPainel(
  db: Db,
  claims: JwtClaims,
  agora: Date = new Date(),
): Promise<{ restaurante: RestaurantePainel; unidades: UnidadePainel[] }> {
  return withUserContext(db, claims, async (tx) => {
    const [r] = await tx
      .select({ id: restaurants.id, nome: restaurants.nome, timezone: restaurants.timezone, politicaFeriado: restaurants.politicaFeriado, politicaUrl: restaurants.politicaUrl })
      .from(restaurants)
      .limit(1)
    if (!r) throw new Error('Restaurante não encontrado')
    const inicioAno = `${agoraLocal(agora, r.timezone).data.slice(0, 4)}-01-01`
    const us = await tx.select().from(units).orderBy(asc(units.ordem), asc(units.nome))
    const ids = us.map((u) => u.id)
    const hs = ids.length === 0 ? [] : await tx
      .select({ unitId: unitHours.unitId, weekday: unitHours.weekday, abre: unitHours.abre, fecha: unitHours.fecha })
      .from(unitHours)
      .where(inArray(unitHours.unitId, ids))
      .orderBy(asc(unitHours.unitId), asc(unitHours.weekday), asc(unitHours.abre))
    const exs = ids.length === 0 ? [] : await tx
      .select({ unitId: unitHourExceptions.unitId, data: unitHourExceptions.data, fechado: unitHourExceptions.fechado, turnos: unitHourExceptions.turnos, motivo: unitHourExceptions.motivo })
      .from(unitHourExceptions)
      .where(and(inArray(unitHourExceptions.unitId, ids), gte(unitHourExceptions.data, inicioAno)))
      .orderBy(asc(unitHourExceptions.data))
    const linhas = new Map(us.map((u) => [u.id, u]))
    const unidades = montarUnidades(us, hs, exs).map((b) => {
      const u = linhas.get(b.id)!
      return { ...b, ativo: u.ativo, slug: u.slug, cep: u.cep, telefone: u.telefone }
    })
    return { restaurante: r, unidades }
  })
}

export function salvarUnidade(
  db: Db,
  claims: JwtClaims,
  restaurantId: string,
  id: string | null,
  dados: DadosUnidade,
): Promise<ResultadoPainel<{ id: string }> | { ok: false; erro: 'capacidade_invalida' }> {
  if (!capacidadeValida(dados.capacidadePessoas)) return Promise.resolve({ ok: false, erro: 'capacidade_invalida' })
  return semPermissaoVira(
    () => withUserContext(db, claims, async (tx) => {
      if (!(await exigirPapel(tx, GESTAO))) return falha('sem_permissao')
      const valores = { ...dados, slug: slugDe(dados.nome) }
      if (id === null) {
        const [u] = await tx.insert(units).values({ restaurantId, ...valores }).returning({ id: units.id })
        await registrarAuditoria(tx, claims, { restaurantId, acao: 'unidade.criada', entidade: 'unit', entidadeId: u!.id, diff: valores })
        return ok({ id: u!.id })
      }
      const [u] = await tx.update(units).set(valores).where(eq(units.id, id)).returning({ id: units.id })
      if (!u) return falha('nao_encontrada')
      await registrarAuditoria(tx, claims, { restaurantId, acao: 'unidade.atualizada', entidade: 'unit', entidadeId: u.id, diff: valores })
      return ok({ id: u.id })
    }),
    { units_restaurant_slug_uq: 'nome_duplicado' as const, units_capacidade_ck: 'capacidade_invalida' as const },
  )
}

async function unidadeVisivel(tx: Tx, unitId: string): Promise<boolean> {
  const [u] = await tx.select({ id: units.id }).from(units).where(eq(units.id, unitId))
  return Boolean(u)
}

/** Substitui a semana inteira da unidade (reenvio não duplica). */
export function salvarHorarios(db: Db, claims: JwtClaims, restaurantId: string, unitId: string, semanal: Turno[][]): Promise<ResultadoPainel> {
  return semPermissaoVira(() => withUserContext(db, claims, async (tx) => {
    if (!(await exigirPapel(tx, GESTAO))) return falha('sem_permissao')
    if (!(await unidadeVisivel(tx, unitId))) return falha('nao_encontrada')
    await tx.delete(unitHours).where(eq(unitHours.unitId, unitId))
    const linhas = semanal.flatMap((dia, weekday) => dia.map((t, i) => ({ restaurantId, unitId, weekday, turno: i + 1, abre: t.abre, fecha: t.fecha })))
    if (linhas.length > 0) await tx.insert(unitHours).values(linhas)
    await registrarAuditoria(tx, claims, { restaurantId, acao: 'unidade.horarios', entidade: 'unit', entidadeId: unitId, diff: { semanal } })
    return ok(null)
  }))
}

export function salvarExcecao(db: Db, claims: JwtClaims, restaurantId: string, unitId: string, e: ExcecaoInput): Promise<ResultadoPainel> {
  return semPermissaoVira(() => withUserContext(db, claims, async (tx) => {
    if (!(await exigirPapel(tx, GESTAO))) return falha('sem_permissao')
    if (!(await unidadeVisivel(tx, unitId))) return falha('nao_encontrada')
    const valores = { fechado: e.fechado, turnos: e.fechado ? [] : e.turnos, motivo: e.motivo }
    await tx
      .insert(unitHourExceptions)
      .values({ restaurantId, unitId, data: e.data, ...valores })
      .onConflictDoUpdate({ target: [unitHourExceptions.unitId, unitHourExceptions.data], set: valores })
    await registrarAuditoria(tx, claims, { restaurantId, acao: 'unidade.excecao_salva', entidade: 'unit', entidadeId: unitId, diff: { data: e.data, ...valores } })
    return ok(null)
  }))
}

export function removerExcecao(db: Db, claims: JwtClaims, restaurantId: string, unitId: string, data: DataIso): Promise<ResultadoPainel> {
  return semPermissaoVira(() => withUserContext(db, claims, async (tx) => {
    if (!(await exigirPapel(tx, GESTAO))) return falha('sem_permissao')
    const apagadas = await tx
      .delete(unitHourExceptions)
      .where(and(eq(unitHourExceptions.unitId, unitId), eq(unitHourExceptions.data, data)))
      .returning({ id: unitHourExceptions.id })
    if (apagadas.length === 0) return falha('nao_encontrada')
    await registrarAuditoria(tx, claims, { restaurantId, acao: 'unidade.excecao_removida', entidade: 'unit', entidadeId: unitId, diff: { data } })
    return ok(null)
  }))
}

export function salvarRestaurante(
  db: Db,
  claims: JwtClaims,
  restaurantId: string,
  d: { nome: string; politicaFeriado: PoliticaFeriado; politicaUrl: string | null },
): Promise<ResultadoPainel> {
  return semPermissaoVira(() => withUserContext(db, claims, async (tx) => {
    if (!(await exigirPapel(tx, ['dono']))) return falha('sem_permissao')
    const [r] = await tx.update(restaurants).set(d).where(eq(restaurants.id, restaurantId)).returning({ id: restaurants.id })
    if (!r) return falha('nao_encontrada')
    await registrarAuditoria(tx, claims, { restaurantId, acao: 'restaurante.atualizado', entidade: 'restaurant', entidadeId: restaurantId, diff: d })
    return ok(null)
  }))
}
