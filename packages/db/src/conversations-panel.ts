import { and, asc, eq, inArray } from 'drizzle-orm'
import type { Db } from './client.ts'
import { filtroSimulacao, lerModoDemonstracao } from './modo-demonstracao.ts'
import { withUserContext, type JwtClaims } from './rls.ts'
import { conversations, customers } from './schema/index.ts'

export type AwaitingItem = { id: string; nome: string | null; estado: 'aguardando_humano' | 'humano'; desde: Date; simulada: boolean }

const COM_HUMANO = ['aguardando_humano', 'humano'] as const

export function listAwaitingHuman(db: Db, claims: JwtClaims): Promise<AwaitingItem[]> {
  return withUserContext(db, claims, async (tx) => {
    const modo = await lerModoDemonstracao(tx)
    const rows = await tx
      .select({ id: conversations.id, nome: customers.nomePerfil, estado: conversations.estado, desde: conversations.lastMessageAt, simulada: conversations.simulada })
      .from(conversations)
      .innerJoin(customers, eq(customers.id, conversations.customerId))
      .where(and(filtroSimulacao(conversations.simulada, modo), inArray(conversations.estado, [...COM_HUMANO])))
      .orderBy(asc(conversations.lastMessageAt))
      .limit(50)
    return rows as AwaitingItem[]
  })
}
