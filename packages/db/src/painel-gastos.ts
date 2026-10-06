import { and, asc, eq, sql } from 'drizzle-orm'
import { periodStarts } from '@atd/core'
import type { Db } from './client.ts'
import { ESCOPOS, type Escopo } from './budget.ts'
import { exigirPapel, falha, ok, registrarAuditoria, semPermissaoVira, type ErroPainel, type ResultadoPainel } from './painel-comum.ts'
import { withUserContext, type JwtClaims } from './rls.ts'
import { budgetCounters, budgetLimits } from './schema/ops.ts'
import { restaurants } from './schema/restaurant.ts'

export type PeriodoGasto = 'dia' | 'mes'
export type LimitePainel = { id: string; escopo: Escopo; periodo: PeriodoGasto; limiteUsd: string; alertaPct: number }
export type AlertaPainel = {
  escopo: Escopo
  periodo: PeriodoGasto
  nivel: 80 | 100
  inicioPeriodo: string
  /** gasto + reservado agora, no período do alerta */
  usoUsd: string
  limiteUsd: string
  criadoEm: Date
}
export type LinhasRelatorio = {
  porDia: { dia: string; realUsd: string; simulacaoUsd: string }[]
  porEtapa: { etapa: string; realUsd: string; simulacaoUsd: string }[]
  porModelo: { modelo: string; realUsd: string; simulacaoUsd: string }[]
  /** Só custo real; `unitId` nulo = "sem unidade" (conversa sem unidade ou execução sem conversa, como a ingestão). */
  porUnidade: { unitId: string | null; unidade: string | null; realUsd: string }[]
  totalRealUsd: string
  totalSimulacaoUsd: string
  /** Conversas reais com custo no mês (base do custo médio por conversa). */
  conversasReais: number
}
export type ResultadoGastos = ResultadoPainel | { ok: false; erro: ErroPainel | 'valor_invalido' }

const ORDEM_ESCOPO = sql`array_position(array['ia','simulacao','whatsapp']::text[], ${budgetLimits.escopo}::text)`
const USD = /^\d{1,6}(\.\d{1,6})?$/ // numeric(12, 6)
const COTACAO = /^\d{1,2}(\.\d{1,4})?$/
const MES = /^(\d{4})-(0[1-9]|1[0-2])$/

/** Limites do restaurante (ordem fixa: ia, simulação, WhatsApp; dia antes de mês) e a cotação. Atendente: sem limites. */
export function lerLimites(db: Db, claims: JwtClaims): Promise<{ limites: LimitePainel[]; cotacao: string }> {
  return withUserContext(db, claims, async (tx) => {
    const limites = await tx
      .select({
        id: budgetLimits.id, escopo: budgetLimits.escopo, periodo: budgetLimits.periodo, limiteUsd: budgetLimits.limiteUsd,
        alertaPct: budgetLimits.alertaPct,
      })
      .from(budgetLimits)
      .where(sql`${budgetLimits.restaurantId} = (select app.my_restaurant_id())`)
      .orderBy(ORDEM_ESCOPO, asc(budgetLimits.periodo))
    const [r] = await tx.select({ cotacao: restaurants.cotacaoUsdBrl }).from(restaurants)
      .where(sql`${restaurants.id} = (select app.my_restaurant_id())`)
    return { limites, cotacao: r?.cotacao ?? '5.5000' }
  })
}

/** Só o dono. `limiteUsd` > 0 (até 6 casas, < 1 milhão: numeric(12, 6)); `alertaPct` 1–100. Cria a linha se faltar. Audita antigo/novo. */
export function salvarLimite(
  db: Db,
  claims: JwtClaims,
  v: { escopo: Escopo; periodo: PeriodoGasto; limiteUsd: string; alertaPct: number },
): Promise<ResultadoGastos> {
  if (!ESCOPOS.includes(v.escopo) || !['dia', 'mes'].includes(v.periodo) || !USD.test(v.limiteUsd) || !/[1-9]/.test(v.limiteUsd)
    || !Number.isInteger(v.alertaPct) || v.alertaPct < 1 || v.alertaPct > 100) {
    return Promise.resolve({ ok: false, erro: 'valor_invalido' })
  }
  return semPermissaoVira(() => withUserContext(db, claims, async (tx) => {
    if (!(await exigirPapel(tx, ['dono']))) return falha('sem_permissao')
    const [atual] = await tx
      .select({ id: budgetLimits.id, restaurantId: budgetLimits.restaurantId, limiteUsd: budgetLimits.limiteUsd, alertaPct: budgetLimits.alertaPct })
      .from(budgetLimits)
      .where(and(eq(budgetLimits.escopo, v.escopo), eq(budgetLimits.periodo, v.periodo)))
      .for('update')
    let id: string
    let restaurantId: string
    if (atual) {
      await tx.update(budgetLimits).set({ limiteUsd: v.limiteUsd, alertaPct: v.alertaPct, updatedAt: sql`now()` }).where(eq(budgetLimits.id, atual.id))
      id = atual.id
      restaurantId = atual.restaurantId
    } else {
      // authenticated só tem INSERT nestas colunas (0035): SQL explícito, sem `id`/`acao`/timestamps
      const [n] = await tx.execute<{ id: string; restaurant_id: string }>(sql`
        insert into public.budget_limits (restaurant_id, escopo, periodo, limite_usd, alerta_pct)
        values ((select app.my_restaurant_id()), ${v.escopo}::public.budget_scope, ${v.periodo}::public.budget_period,
                ${v.limiteUsd}::numeric, ${v.alertaPct})
        returning id, restaurant_id`)
      id = n!.id
      restaurantId = n!.restaurant_id
    }
    await registrarAuditoria(tx, claims, {
      restaurantId, acao: 'orcamento.limite_alterado', entidade: 'budget_limit', entidadeId: id,
      diff: {
        escopo: v.escopo, periodo: v.periodo,
        de: atual ? { limiteUsd: atual.limiteUsd, alertaPct: atual.alertaPct } : null,
        para: { limiteUsd: v.limiteUsd, alertaPct: v.alertaPct },
      },
    })
    return ok(null)
  }))
}

/** Só o dono. Cotação US$ → R$ (só exibição) entre 0,5 e 50, até 4 casas. Auditada. */
export function salvarCotacao(db: Db, claims: JwtClaims, cotacao: string): Promise<ResultadoGastos> {
  const n = Number(cotacao)
  if (!COTACAO.test(cotacao) || n < 0.5 || n > 50) return Promise.resolve({ ok: false, erro: 'valor_invalido' })
  return semPermissaoVira(() => withUserContext(db, claims, async (tx) => {
    if (!(await exigirPapel(tx, ['dono']))) return falha('sem_permissao')
    const [atual] = await tx.select({ id: restaurants.id, cotacao: restaurants.cotacaoUsdBrl }).from(restaurants)
      .where(sql`${restaurants.id} = (select app.my_restaurant_id())`).for('update')
    if (!atual) return falha('sem_permissao')
    await tx.update(restaurants).set({ cotacaoUsdBrl: cotacao, updatedAt: sql`now()` }).where(eq(restaurants.id, atual.id))
    await registrarAuditoria(tx, claims, {
      restaurantId: atual.id, acao: 'orcamento.cotacao_alterada', entidade: 'restaurant', entidadeId: atual.id,
      diff: { de: atual.cotacao, para: cotacao },
    })
    return ok(null)
  }))
}

const zeros = (): Record<Escopo, string> => ({ ia: '0', simulacao: '0', whatsapp: '0' })

/**
 * Gasto (liquidado) de hoje e do mês por escopo, no fuso do restaurante, e os alertas dos períodos correntes com o uso
 * atual (gasto + reservado) e o limite. Atendente: tudo zerado e sem alertas (RLS).
 */
export function resumoGastos(
  db: Db,
  claims: JwtClaims,
  agora: Date,
): Promise<{ hoje: Record<Escopo, string>; mes: Record<Escopo, string>; alertas: AlertaPainel[] }> {
  return withUserContext(db, claims, async (tx) => {
    const hoje = zeros()
    const mes = zeros()
    const [r] = await tx.select({ tz: restaurants.timezone }).from(restaurants).where(sql`${restaurants.id} = (select app.my_restaurant_id())`)
    if (!r) return { hoje, mes, alertas: [] }
    const inicio = periodStarts(agora, r.tz)
    const corrente = sql`((${budgetCounters.periodo} = 'dia' and ${budgetCounters.inicioPeriodo} = ${inicio.dia})
      or (${budgetCounters.periodo} = 'mes' and ${budgetCounters.inicioPeriodo} = ${inicio.mes}))`
    const contadores = await tx
      .select({ escopo: budgetCounters.escopo, periodo: budgetCounters.periodo, gasto: budgetCounters.gasto, reservado: budgetCounters.reservado })
      .from(budgetCounters)
      .where(and(sql`${budgetCounters.restaurantId} = (select app.my_restaurant_id())`, corrente))
    for (const c of contadores) (c.periodo === 'dia' ? hoje : mes)[c.escopo] = c.gasto

    const alertas = await tx.execute<{
      escopo: Escopo; periodo: PeriodoGasto; nivel: number; inicio_periodo: string; uso: string; limite: string | null; criado_em: string
    }>(sql`
      select a.escopo, a.periodo, a.nivel, to_char(a.inicio_periodo, 'YYYY-MM-DD') as inicio_periodo,
             coalesce(c.gasto + c.reservado, 0)::numeric(12, 6)::text as uso, l.limite_usd::text as limite, a.created_at as criado_em
        from public.budget_alerts a
        left join public.budget_counters c
          on c.restaurant_id = a.restaurant_id and c.escopo = a.escopo and c.periodo = a.periodo and c.inicio_periodo = a.inicio_periodo
        left join public.budget_limits l on l.restaurant_id = a.restaurant_id and l.escopo = a.escopo and l.periodo = a.periodo
       where a.restaurant_id = (select app.my_restaurant_id())
         and ((a.periodo = 'dia' and a.inicio_periodo = ${inicio.dia}::date) or (a.periodo = 'mes' and a.inicio_periodo = ${inicio.mes}::date))
       order by a.nivel desc, array_position(array['ia','simulacao','whatsapp']::text[], a.escopo::text), a.periodo`)
    // um alerta por escopo+período: o nível mais alto (100 esconde o 80 do mesmo período)
    const vistos = new Set<string>()
    const lista: AlertaPainel[] = []
    for (const a of alertas) {
      const chave = `${a.escopo}:${a.periodo}`
      if (vistos.has(chave)) continue
      vistos.add(chave)
      lista.push({
        escopo: a.escopo, periodo: a.periodo, nivel: a.nivel as 80 | 100, inicioPeriodo: a.inicio_periodo, usoUsd: a.uso,
        limiteUsd: a.limite ?? '0', criadoEm: new Date(a.criado_em),
      })
    }
    return { hoje, mes, alertas: lista }
  })
}

const vazio = (): LinhasRelatorio => ({
  porDia: [], porEtapa: [], porModelo: [], porUnidade: [], totalRealUsd: '0', totalSimulacaoUsd: '0', conversasReais: 0,
})

/**
 * Relatório do mês ('AAAA-MM', no fuso do restaurante) a partir de `ai_runs`: por dia (real × simulação), por etapa,
 * por modelo, por unidade (só real; `conversations.unidade_contexto_id`, "sem unidade" à parte) e conversas reais.
 * Dono e gerente com MFA; para os demais volta vazio. Mês fora do formato lança `mes_invalido`.
 */
export async function relatorioMes(db: Db, claims: JwtClaims, mes: string): Promise<LinhasRelatorio> {
  if (!MES.test(mes)) throw new Error('mes_invalido')
  const inicioMes = `${mes}-01`
  return withUserContext(db, claims, async (tx) => {
    const [ctx] = await tx.execute<{ rid: string | null; gestao: boolean | null; mfa: boolean | null }>(sql`
      select app.my_restaurant_id() as rid, app.my_role() in ('dono','gerente') as gestao, app.mfa_ok() as mfa`)
    if (!ctx?.rid || !ctx.gestao || !ctx.mfa) return vazio()
    const [r] = await tx.select({ tz: restaurants.timezone }).from(restaurants).where(eq(restaurants.id, ctx.rid))
    if (!r) return vazio()
    // limites do mês como constantes: casam com o índice ai_runs (restaurant_id, created_at)
    const filtro = sql`
      r.restaurant_id = ${ctx.rid}::uuid
      and r.created_at >= (${inicioMes}::date)::timestamp at time zone ${r.tz}::text
      and r.created_at < ((${inicioMes}::date + interval '1 month')::date)::timestamp at time zone ${r.tz}::text`
    const real = sql`coalesce(sum(r.cost_usd) filter (where not r.simulado), 0)::text`
    const simul = sql`coalesce(sum(r.cost_usd) filter (where r.simulado), 0)::text`

    const porDia = await tx.execute<{ dia: string; realUsd: string; simulacaoUsd: string }>(sql`
      select to_char((r.created_at at time zone ${r.tz}::text)::date, 'YYYY-MM-DD') as "dia", ${real} as "realUsd", ${simul} as "simulacaoUsd"
        from public.ai_runs r where ${filtro} group by 1 order by 1`)
    const porEtapa = await tx.execute<{ etapa: string; realUsd: string; simulacaoUsd: string }>(sql`
      select r.etapa::text as "etapa", ${real} as "realUsd", ${simul} as "simulacaoUsd"
        from public.ai_runs r where ${filtro} group by 1 order by 1`)
    const porModelo = await tx.execute<{ modelo: string; realUsd: string; simulacaoUsd: string }>(sql`
      select r.modelo as "modelo", ${real} as "realUsd", ${simul} as "simulacaoUsd"
        from public.ai_runs r where ${filtro} group by 1 order by 1`)
    const [tot] = await tx.execute<{ realUsd: string; simulacaoUsd: string; conversasReais: number }>(sql`
      select ${real} as "realUsd", ${simul} as "simulacaoUsd",
             (count(distinct r.conversation_id) filter (where not r.simulado))::int as "conversasReais"
        from public.ai_runs r where ${filtro}`)
    // Por unidade numa função `security definer`: o custo é do restaurante todo para dono e gerente, mas a RLS de
    // conversations esconde as de outras unidades de quem é restrito — sob RLS elas cairiam em "sem unidade".
    const porUnidade = await tx.execute<{ unitId: string | null; unidade: string | null; realUsd: string }>(sql`
      select unit_id as "unitId", unidade as "unidade", real_usd::text as "realUsd"
        from app.custo_por_unidade((${inicioMes}::date)::timestamp at time zone ${r.tz}::text,
                                   ((${inicioMes}::date + interval '1 month')::date)::timestamp at time zone ${r.tz}::text)
       order by unidade nulls last, unit_id`)
    return {
      porDia: [...porDia], porEtapa: [...porEtapa], porModelo: [...porModelo], porUnidade: [...porUnidade],
      totalRealUsd: tot?.realUsd ?? '0', totalSimulacaoUsd: tot?.simulacaoUsd ?? '0', conversasReais: tot?.conversasReais ?? 0,
    }
  })
}
