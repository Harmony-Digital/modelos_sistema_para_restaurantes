import { sql } from 'drizzle-orm'
import { agoraLocal, somarDias } from '@atd/core'
import type { Db } from './client.ts'
import { filtroSimulacao, lerModoDemonstracao } from './modo-demonstracao.ts'
import { withUserContext, type JwtClaims } from './rls.ts'
import { conversations } from './schema/conversation.ts'
import { restaurants } from './schema/restaurant.ts'

const FUSO_PADRAO = 'America/Sao_Paulo'

/** Um dia da série do Início: conversas com mensagem do cliente e gasto da IA (US$, numeric em texto). */
export type DiaSerie = { dia: string; conversas: number; gastoUsd: string }

/**
 * Mini-gráficos do Início: os últimos 7 dias (fuso do restaurante, do mais antigo para hoje), numa consulta só.
 * - conversas: conversas distintas com mensagem do cliente no dia (`messages_restaurant_created_idx`); RLS por
 *   unidade vale (gerente restrito só conta as suas). Simuladas só no modo demonstração.
 * - gasto: contador diário da IA (`budget_counters_period_uq`); no modo demonstração soma também o do simulador.
 *   RLS: só dono/gerente leem contadores — para os demais o gasto volta zero.
 */
export function serieUltimos7Dias(db: Db, claims: JwtClaims, agora: Date = new Date()): Promise<DiaSerie[]> {
  return withUserContext(db, claims, async (tx) => {
    const [r] = await tx.select({ tz: restaurants.timezone }).from(restaurants).limit(1)
    const tz = r?.tz ?? FUSO_PADRAO
    const modo = await lerModoDemonstracao(tx)
    const hoje = agoraLocal(agora, tz).data
    const inicio = somarDias(hoje, -6)
    const reais = filtroSimulacao(conversations.simulada, modo) ?? sql`true`
    const escopos = modo ? sql`('ia', 'simulacao')` : sql`('ia')`
    const rows = await tx.execute<{ dia: string; conversas: number; gasto_usd: string }>(sql`
      with dias as (
        select d::date as dia from generate_series(${inicio}::date, ${hoje}::date, interval '1 day') d
      ), conv as (
        select (m.created_at at time zone ${tz})::date as dia, count(distinct m.conversation_id)::int as n
          from public.messages m
          join public.conversations on conversations.id = m.conversation_id
         where m.restaurant_id = (select app.my_restaurant_id())
           and m.created_at >= (${inicio}::date)::timestamp at time zone ${tz}
           and m.created_at < (${hoje}::date + 1)::timestamp at time zone ${tz}
           and m.direcao = 'in'
           and ${reais}
         group by 1
      ), gasto as (
        select b.inicio_periodo as dia, sum(b.gasto) as g
          from public.budget_counters b
         where b.restaurant_id = (select app.my_restaurant_id())
           and b.periodo = 'dia'
           and b.escopo in ${escopos}
           and b.inicio_periodo between ${inicio}::date and ${hoje}::date
         group by 1
      )
      select to_char(dias.dia, 'YYYY-MM-DD') as dia,
             coalesce(conv.n, 0)::int as conversas,
             coalesce(gasto.g, 0)::numeric(14, 6)::text as gasto_usd
        from dias
        left join conv on conv.dia = dias.dia
        left join gasto on gasto.dia = dias.dia
       order by dias.dia`)
    return rows.map((x) => ({ dia: x.dia, conversas: Number(x.conversas), gastoUsd: x.gasto_usd }))
  })
}
