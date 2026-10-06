import { asc, eq, sql } from 'drizzle-orm'
import { decryptPhone } from '@atd/core'
import type { Db } from './client.ts'
import { falha, ok, registrarAuditoria, type ResultadoPainel } from './painel-comum.ts'
import { withUserContext, type JwtClaims } from './rls.ts'
import { conversations, customers } from './schema/conversation.ts'
import { units } from './schema/restaurant.ts'
import { TELEFONE_SIMULADO } from './simulador.ts'

export type AcessoInbox = { restaurantId: string; todas: boolean; unidades: { id: string; nome: string }[] }

/**
 * O que a pessoa enxerga da inbox: tópicos do Realtime e filtro de unidade. Quem acessa todas as unidades vê a lista
 * inteira; os demais só as de `app.minhas_unidades()`. Sem staff ativo ou sem MFA exigido ⇒ null.
 */
export function acessoInbox(db: Db, claims: JwtClaims): Promise<AcessoInbox | null> {
  return withUserContext(db, claims, async (tx) => {
    const [r] = await tx.execute<{ restaurant_id: string | null; todas: boolean; unidades: string; mfa: boolean }>(sql`
      select app.my_restaurant_id() as restaurant_id, app.acesso_todas_unidades() as todas,
             app.minhas_unidades()::text as unidades, app.mfa_ok() as mfa`)
    if (!r?.restaurant_id || !r.mfa) return null
    const minhas = new Set(r.unidades.replace(/^\{|\}$/g, '').split(',').filter(Boolean))
    const us = await tx.select({ id: units.id, nome: units.nome }).from(units).orderBy(asc(units.ordem), asc(units.nome))
    return { restaurantId: r.restaurant_id, todas: r.todas, unidades: r.todas ? us : us.filter((u) => minhas.has(u.id)) }
  })
}

/**
 * Telefone do cliente da conversa, sob demanda: só se a conversa é visível (RLS de conversations por unidade) e
 * auditado. Conversa simulada não tem telefone. Nunca logar o número.
 */
export function revelarTelefoneConversa(
  db: Db,
  claims: JwtClaims,
  conversationId: string,
  phoneKey: Buffer,
): Promise<ResultadoPainel<{ telefone: string }>> {
  return withUserContext(db, claims, async (tx) => {
    const [r] = await tx
      .select({ restaurantId: conversations.restaurantId, cifrado: customers.telefoneCifrado, simulada: conversations.simulada })
      .from(conversations)
      .innerJoin(customers, eq(customers.id, conversations.customerId))
      .where(eq(conversations.id, conversationId))
    if (!r || r.simulada || r.cifrado === TELEFONE_SIMULADO) return falha('nao_encontrada')
    const telefone = decryptPhone(r.cifrado, phoneKey)
    await registrarAuditoria(tx, claims, {
      restaurantId: r.restaurantId, acao: 'conversa.telefone_visualizado', entidade: 'conversation', entidadeId: conversationId,
    })
    return ok({ telefone })
  })
}
