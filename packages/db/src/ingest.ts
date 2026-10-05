import { eq, sql } from 'drizzle-orm'
import type { Db } from './client.ts'
import type { Enqueue } from './queue.ts'
import { conversations, customers, messages } from './schema/conversation.ts'

export type IngestInput = {
  restaurantId: string
  waIdHash: string
  telefoneCifrado: string
  profileName: string | null
  wamid: string
  tipo: 'texto' | 'audio' | 'imagem' | 'documento' | 'outro'
  texto: string | null
  mediaId: string | null
  /** Horário da mensagem segundo a Meta. */
  timestamp: Date
  /** id da linha/botão escolhido numa mensagem interativa */
  interativoId?: string | null
}

/** Transação única do webhook: cliente → conversa → mensagem idempotente → job (I7). */
export function ingestInbound(db: Db, input: IngestInput, enqueue: Enqueue) {
  return db.transaction(async (tx) => {
    const [customer] = await tx
      .insert(customers)
      .values({
        restaurantId: input.restaurantId,
        waIdHash: input.waIdHash,
        telefoneCifrado: input.telefoneCifrado,
        nomePerfil: input.profileName,
      })
      .onConflictDoUpdate({
        target: [customers.restaurantId, customers.waIdHash],
        set: {
          nomePerfil: sql`coalesce(excluded.nome_perfil, ${customers.nomePerfil})`,
          ultimaInteracaoAt: sql`now()`,
        },
      })
      .returning({ id: customers.id })

    // O upsert do cliente serializa transações do mesmo cliente; aqui a reentrega já é visível.
    const [existing] = await tx
      .select({ conversationId: messages.conversationId })
      .from(messages)
      .where(eq(messages.wamid, input.wamid))
    if (existing) return { inserted: false, conversationId: existing.conversationId }

    const ts = sql`${input.timestamp.toISOString()}::timestamptz`
    const [conversation] = await tx
      .insert(conversations)
      .values({
        restaurantId: input.restaurantId,
        customerId: customer!.id,
        windowExpiresAt: sql`${ts} + interval '24 hours'`,
        lastMessageAt: ts,
      })
      .onConflictDoUpdate({
        target: conversations.customerId,
        targetWhere: sql`estado <> 'encerrada'`,
        set: {
          lastMessageAt: sql`greatest(${conversations.lastMessageAt}, ${ts})`,
          windowExpiresAt: sql`greatest(coalesce(${conversations.windowExpiresAt}, '-infinity'::timestamptz), ${ts} + interval '24 hours')`,
        },
      })
      .returning({ id: conversations.id })

    const inserted = await tx
      .insert(messages)
      .values({
        restaurantId: input.restaurantId,
        conversationId: conversation!.id,
        direcao: 'in',
        autor: 'cliente',
        wamid: input.wamid,
        tipo: input.tipo,
        texto: input.texto,
        midiaRef: input.mediaId ? { mediaId: input.mediaId } : null,
        payload: input.interativoId ? { interativoId: input.interativoId } : null,
      })
      .onConflictDoNothing({ target: messages.wamid })
      .returning({ id: messages.id })

    if (inserted.length > 0) await enqueue(tx, conversation!.id)
    return { inserted: inserted.length > 0, conversationId: conversation!.id }
  })
}

export async function applyStatus(db: Db, s: { wamid: string; status: string; errorCode: number | null }) {
  await db
    .update(messages)
    .set({ statusEnvio: s.errorCode ? `${s.status}:${s.errorCode}` : s.status })
    .where(eq(messages.wamid, s.wamid))
}
