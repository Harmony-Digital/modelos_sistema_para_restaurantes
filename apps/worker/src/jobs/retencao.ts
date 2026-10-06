import { sql } from 'drizzle-orm'
import type { PgBoss } from 'pg-boss'
import { QUEUES, restaurantesAtivos, schema, type Db } from '@atd/db'
import type { Logger } from '../logger.ts'

export const RETENCAO_CRON = '0 3 * * *'
export const RETENCAO_TZ = 'America/Sao_Paulo'
/** Linhas por regra em cada chamada de `app.aplicar_retencao` (transações curtas). */
export const RETENCAO_LOTE = 5000
/** Teto de chamadas por restaurante numa execução; o que sobrar fica para o dia seguinte (auditado `pendente`). */
export const RETENCAO_MAX_ITERACOES = 50

/**
 * Agenda a retenção diária às 03:00 de São Paulo. `boss.schedule` atualiza o agendamento se já existir (um por fila),
 * então chamar a cada boot não duplica. `missed` padrão (`skip`): worker parado às 03:00 só roda no dia seguinte, e a
 * retenção é idempotente.
 */
export async function agendarRetencao(boss: Pick<PgBoss, 'schedule'>): Promise<void> {
  await boss.schedule(QUEUES.retencao, RETENCAO_CRON, {}, { tz: RETENCAO_TZ })
}

type Contagens = Record<string, number>
export type RetencaoDeps = { db: Db; log: Logger; now?: () => Date }

/**
 * Aplica a retenção em todos os restaurantes: chama `app.aplicar_retencao` (cada chamada é uma transação própria) até
 * `pendente` voltar falso ou o teto de iterações, e audita `retencao.executada` (ator `sistema`; só contagens, sem PII).
 * Falha num restaurante é registrada e não impede os outros; o chamador decide se relança (`falhas > 0`).
 */
export async function aplicarRetencaoDiaria(
  deps: RetencaoDeps,
  o: { lote?: number; maxIteracoes?: number } = {},
): Promise<{ restaurantes: number; falhas: number }> {
  const lote = o.lote ?? RETENCAO_LOTE
  const max = o.maxIteracoes ?? RETENCAO_MAX_ITERACOES
  const agora = (deps.now ?? (() => new Date()))()
  const ids = await restaurantesAtivos(deps.db)
  let falhas = 0
  for (const restaurantId of ids) {
    try {
      const total: Contagens = {}
      let pendente = true
      let iteracoes = 0
      while (pendente && iteracoes < max) {
        const [linha] = await deps.db.execute<{ r: Record<string, number | boolean> }>(
          sql`select app.aplicar_retencao(${restaurantId}::uuid, ${agora.toISOString()}::timestamptz, ${lote}::int) as r`,
        )
        iteracoes++
        const r = linha!.r
        if (r.ja_inexistente) { pendente = false; break }
        pendente = r.pendente === true
        for (const [k, v] of Object.entries(r)) if (typeof v === 'number') total[k] = (total[k] ?? 0) + v
      }
      await deps.db.insert(schema.auditLog).values({
        restaurantId, atorTipo: 'sistema', acao: 'retencao.executada', entidade: 'restaurant', entidadeId: restaurantId,
        diff: { ...total, iteracoes, pendente },
      })
      if (pendente) deps.log.warn({ restaurantId, iteracoes }, 'retenção parou no teto de iterações; continua amanhã')
      else deps.log.info({ restaurantId, iteracoes }, 'retenção aplicada')
    } catch (err) {
      falhas++
      deps.log.error({ err, restaurantId }, 'falha ao aplicar a retenção')
    }
  }
  return { restaurantes: ids.length, falhas }
}
