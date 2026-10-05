import { and, desc, eq, inArray } from 'drizzle-orm'
import type { Db } from './client.ts'
import { withUserContext, type JwtClaims } from './rls.ts'
import { auditLog, conversations, customers } from './schema/index.ts'

export type AwaitingItem = { id: string; nome: string | null; estado: 'aguardando_humano' | 'humano'; desde: Date }
export type ReturnResult = 'devolvida' | 'ja_estava' | 'nao_encontrada'

const COM_HUMANO = ['aguardando_humano', 'humano'] as const

export function listAwaitingHuman(db: Db, claims: JwtClaims): Promise<AwaitingItem[]> {
  return withUserContext(db, claims, async (tx) => {
    const rows = await tx
      .select({ id: conversations.id, nome: customers.nomePerfil, estado: conversations.estado, desde: conversations.lastMessageAt })
      .from(conversations)
      .innerJoin(customers, eq(customers.id, conversations.customerId))
      .where(inArray(conversations.estado, [...COM_HUMANO]))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(50)
    return rows as AwaitingItem[]
  })
}

export function returnToAi(db: Db, claims: JwtClaims, conversationId: string): Promise<ReturnResult> {
  return withUserContext(db, claims, async (tx) => {
    const [row] = await tx
      .update(conversations)
      .set({ estado: 'ia', atendenteId: null })
      .where(and(eq(conversations.id, conversationId), inArray(conversations.estado, [...COM_HUMANO])))
      .returning({ id: conversations.id, restaurantId: conversations.restaurantId })
    if (row) {
      await tx.insert(auditLog).values({
        restaurantId: row.restaurantId,
        atorId: claims.sub,
        atorTipo: 'staff',
        acao: 'conversa.devolvida_ia',
        entidade: 'conversation',
        entidadeId: row.id,
      })
      return 'devolvida'
    }
    const [existe] = await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, conversationId))
    return existe ? 'ja_estava' : 'nao_encontrada'
  })
}
