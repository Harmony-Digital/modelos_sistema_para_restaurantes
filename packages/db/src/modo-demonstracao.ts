import { eq, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import type { Db } from './client.ts'
import { exigirPapel, falha, ok, registrarAuditoria, semPermissaoVira, type ResultadoPainel } from './painel-comum.ts'
import { withUserContext, type JwtClaims, type Tx } from './rls.ts'
import { restaurants } from './schema/restaurant.ts'

/**
 * Modo demonstração (07/10/2026): ligado, o painel mostra o que nasceu no simulador como se fosse real (com o selo
 * "Simulação"); desligado, os dados simulados ficam isolados como sempre. Ponto único de verdade para as consultas.
 */
export async function lerModoDemonstracao(tx: Tx): Promise<boolean> {
  // RLS: só o restaurante do usuário; sem acesso ⇒ desligado (isolamento)
  const [r] = await tx.select({ m: restaurants.modoDemonstracao }).from(restaurants).limit(1)
  return r?.m ?? false
}

/** Filtro de simulação: desligado ⇒ só dados reais (`coluna = false`); ligado ⇒ sem filtro. */
export function filtroSimulacao(simulado: AnyPgColumn, modo: boolean): SQL | undefined {
  return modo ? undefined : eq(simulado, false)
}

export function modoDemonstracao(db: Db, claims: JwtClaims): Promise<boolean> {
  return withUserContext(db, claims, (tx) => lerModoDemonstracao(tx))
}

/** Só o dono liga ou desliga; auditado com antes e depois (sem PII). Mesmo valor ⇒ nada muda nem é auditado. */
export function salvarModoDemonstracao(db: Db, claims: JwtClaims, restaurantId: string, ligado: boolean): Promise<ResultadoPainel> {
  return semPermissaoVira(() => withUserContext(db, claims, async (tx) => {
    if (!(await exigirPapel(tx, ['dono']))) return falha('sem_permissao')
    const [antes] = await tx
      .select({ m: restaurants.modoDemonstracao })
      .from(restaurants)
      .where(eq(restaurants.id, restaurantId))
      .for('update')
    if (!antes) return falha('nao_encontrada')
    if (antes.m === ligado) return ok(null)
    const [r] = await tx
      .update(restaurants)
      .set({ modoDemonstracao: ligado, updatedAt: new Date() })
      .where(eq(restaurants.id, restaurantId))
      .returning({ id: restaurants.id })
    if (!r) return falha('nao_encontrada')
    await registrarAuditoria(tx, claims, {
      restaurantId, acao: 'restaurante.modo_demonstracao', entidade: 'restaurant', entidadeId: restaurantId,
      diff: { de: antes.m, para: ligado },
    })
    return ok(null)
  }))
}
