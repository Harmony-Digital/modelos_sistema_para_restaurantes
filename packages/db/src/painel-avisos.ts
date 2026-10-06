import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm'
import { agoraLocal } from '@atd/core'
import type { Db } from './client.ts'
import { exigirPapel, falha, ok, registrarAuditoria, semPermissaoVira, type ResultadoPainel } from './painel-comum.ts'
import { withUserContext, type JwtClaims } from './rls.ts'
import { restaurants, units } from './schema/restaurant.ts'
import { attendanceNotices } from './schema/s2.ts'

const GESTAO = ['dono', 'gerente'] as const
const FUSO_PADRAO = 'America/Sao_Paulo'

export type AvisoPainel = {
  id: string
  unitId: string
  nome: string | null
  pessoas: number
  horarioAprox: string | null
  origem: 'ia' | 'painel'
  status: 'ativo' | 'cancelado'
}
export type PrevisaoUnidade = { unitId: string; unidade: string; totalPessoas: number; avisos: AvisoPainel[] }

/** Previsão do dia por unidade ativa visível (mesma ordem do S1). Simulados nunca entram; o total é só de ativos. */
export function previsaoDoDia(
  db: Db,
  claims: JwtClaims,
  p: { data: string; incluirCancelados: boolean },
): Promise<PrevisaoUnidade[]> {
  return withUserContext(db, claims, async (tx) => {
    const us = await tx
      .select({ id: units.id, nome: units.nome })
      .from(units)
      .where(eq(units.ativo, true))
      .orderBy(asc(units.ordem), asc(units.nome))
    if (us.length === 0) return []
    const rows = await tx
      .select({
        id: attendanceNotices.id, unitId: attendanceNotices.unitId, nome: attendanceNotices.nome,
        pessoas: attendanceNotices.pessoas, horarioAprox: attendanceNotices.horarioAprox,
        origem: attendanceNotices.origem, status: attendanceNotices.status,
      })
      .from(attendanceNotices)
      .where(and(
        inArray(attendanceNotices.unitId, us.map((u) => u.id)),
        eq(attendanceNotices.data, p.data),
        eq(attendanceNotices.simulado, false),
        p.incluirCancelados ? undefined : eq(attendanceNotices.status, 'ativo'),
      ))
      .orderBy(asc(attendanceNotices.createdAt), asc(attendanceNotices.id))
    return us.map((u) => {
      const avisos = rows.filter((r) => r.unitId === u.id)
      return {
        unitId: u.id,
        unidade: u.nome,
        totalPessoas: avisos.reduce((s, a) => s + (a.status === 'ativo' ? a.pessoas : 0), 0),
        avisos,
      }
    })
  })
}

/** Total de pessoas previstas hoje (fuso do restaurante) nas unidades visíveis ao usuário. */
export function totalPrevistoHoje(db: Db, claims: JwtClaims, agora: Date = new Date()): Promise<number> {
  return withUserContext(db, claims, async (tx) => {
    const [r] = await tx.select({ tz: restaurants.timezone }).from(restaurants)
    const hoje = agoraLocal(agora, r?.tz ?? FUSO_PADRAO).data
    const [t] = await tx
      .select({ total: sql<number>`coalesce(sum(${attendanceNotices.pessoas}), 0)::int` })
      .from(attendanceNotices)
      .innerJoin(units, and(eq(units.id, attendanceNotices.unitId), eq(units.ativo, true)))
      .where(and(
        eq(attendanceNotices.data, hoje),
        eq(attendanceNotices.status, 'ativo'),
        eq(attendanceNotices.simulado, false),
      ))
    return t?.total ?? 0
  })
}

export function criarAvisoPainel(
  db: Db,
  claims: JwtClaims,
  p: { unitId: string; data: string; pessoas: number; horarioAprox: string | null; nome: string | null },
): Promise<ResultadoPainel<{ id: string }>> {
  return semPermissaoVira(() => withUserContext(db, claims, async (tx) => {
    if (!(await exigirPapel(tx, GESTAO))) return falha('sem_permissao')
    const rows = await tx.execute<{ rid: string | null }>(sql`select app.my_restaurant_id() as rid`)
    const restaurantId = rows[0]?.rid
    if (!restaurantId) return falha('sem_permissao')
    // a policy de insert recusa (42501) unidade fora do acesso do usuário. SQL explícito: authenticated só tem
    // INSERT nas colunas abaixo (0022) e o insert do Drizzle lista todas as colunas da tabela, com DEFAULT
    const [a] = await tx.execute<{ id: string }>(sql`
      insert into public.attendance_notices (restaurant_id, unit_id, data, pessoas, horario_aprox, nome, origem, criado_por)
      values (${restaurantId}, ${p.unitId}, ${p.data}, ${p.pessoas}, ${p.horarioAprox}, ${p.nome}, 'painel', ${claims.sub})
      returning id`)
    await registrarAuditoria(tx, claims, {
      restaurantId, acao: 'aviso.criado_painel', entidade: 'attendance_notice', entidadeId: a!.id,
      diff: { unitId: p.unitId, data: p.data, pessoas: p.pessoas, horarioAprox: p.horarioAprox },
    })
    return ok({ id: a!.id })
  }))
}

/** Cancela aviso ativo de hoje em diante (fuso do restaurante); dia passado é só consulta. */
export function cancelarAvisoPainel(db: Db, claims: JwtClaims, avisoId: string, agora: Date = new Date()): Promise<ResultadoPainel> {
  return semPermissaoVira(() => withUserContext(db, claims, async (tx) => {
    // UPDATE que a policy filtra não dá erro: o papel é conferido antes
    if (!(await exigirPapel(tx, GESTAO))) return falha('sem_permissao')
    const [rest] = await tx.select({ tz: restaurants.timezone }).from(restaurants)
    const hoje = agoraLocal(agora, rest?.tz ?? FUSO_PADRAO).data
    const r = await tx
      .update(attendanceNotices)
      .set({ status: 'cancelado', updatedAt: sql`now()` })
      .where(and(eq(attendanceNotices.id, avisoId), eq(attendanceNotices.status, 'ativo'), gte(attendanceNotices.data, hoje)))
      .returning({ restaurantId: attendanceNotices.restaurantId, unitId: attendanceNotices.unitId, data: attendanceNotices.data })
    const a = r[0]
    if (!a) return falha('nao_encontrada')
    await registrarAuditoria(tx, claims, {
      restaurantId: a.restaurantId, acao: 'aviso.cancelado_painel', entidade: 'attendance_notice', entidadeId: avisoId,
      diff: { unitId: a.unitId, data: a.data },
    })
    return ok(null)
  }))
}
