import { sql } from 'drizzle-orm'
import type { Db } from './client.ts'
import { withUserContext, type JwtClaims } from './rls.ts'

export type StaffRole = 'dono' | 'gerente' | 'atendente'

/** Usa as funções security definer: responde mesmo em aal1 (a barreira MFA esconde as linhas, não o papel). */
export function getStaffContext(db: Db, claims: JwtClaims) {
  return withUserContext(db, claims, async (tx) => {
    const rows = await tx.execute<{ papel: StaffRole | null; rid: string | null }>(
      sql`select app.my_role()::text as papel, app.my_restaurant_id() as rid`,
    )
    const r = rows[0]
    return r?.papel && r.rid ? { role: r.papel, restaurantId: r.rid } : null
  })
}
