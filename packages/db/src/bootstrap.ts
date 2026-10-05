import { sql } from 'drizzle-orm'
import type { Db } from './client.ts'
import { budgetLimits, retentionSettings } from './schema/ops.ts'
import { restaurants, staff } from './schema/restaurant.ts'
import type { StaffRole } from './staff.ts'

export const DEFAULT_BUDGET = [
  { escopo: 'ia', periodo: 'dia', limiteUsd: '2' },
  { escopo: 'ia', periodo: 'mes', limiteUsd: '40' },
  { escopo: 'whatsapp', periodo: 'dia', limiteUsd: '1' },
  { escopo: 'whatsapp', periodo: 'mes', limiteUsd: '20' },
] as const

// PRD §6.6 — pendência P2: confirmar com o restaurante/jurídico.
export const DEFAULT_RETENTION = [
  { dado: 'messages', dias: 90, acao: 'apagar' },
  { dado: 'attendance_notices', dias: 30, acao: 'anonimizar' },
  { dado: 'event_requests', dias: 730, acao: 'anonimizar' },
  { dado: 'ai_runs', dias: 395, acao: 'apagar' },
  { dado: 'customers_inativos', dias: 365, acao: 'apagar' },
  { dado: 'audit_log', dias: 730, acao: 'apagar' },
  { dado: 'audio', dias: 0, acao: 'apagar' },
] as const

export async function bootstrapRestaurant(db: Db, p: { nome: string; politicaUrl?: string }): Promise<string> {
  return db.transaction(async (tx) => {
    // Serializa bootstraps concorrentes (evita dois restaurantes).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('atd:bootstrap'))`)
    const existing = await tx.select({ id: restaurants.id }).from(restaurants).limit(2)
    if (existing.length > 1) throw new Error('Mais de um restaurante no banco; bootstrap abortado')
    const restaurantId =
      existing[0]?.id ??
      (await tx.insert(restaurants).values({ nome: p.nome, politicaUrl: p.politicaUrl ?? null }).returning({ id: restaurants.id }))[0]!.id

    await tx.insert(budgetLimits).values(DEFAULT_BUDGET.map((b) => ({ ...b, restaurantId }))).onConflictDoNothing()
    await tx.insert(retentionSettings).values(DEFAULT_RETENTION.map((r) => ({ ...r, restaurantId }))).onConflictDoNothing()
    return restaurantId
  })
}

export async function addStaff(db: Db, p: { userId: string; restaurantId: string; nome: string; papel: StaffRole }) {
  await db.insert(staff).values(p).onConflictDoNothing({ target: staff.userId })
}
