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

    const [conversation] = await tx
      .insert(conversations)
      .values({
        restaurantId: input.restaurantId,
        customerId: customer!.id,
        windowExpiresAt: sql`now() + interval '24 hours'`,
      })
      .onConflictDoUpdate({
        target: conversations.customerId,
        targetWhere: sql`estado <> 'encerrada'`,
        set: { lastMessageAt: sql`now()`, windowExpiresAt: sql`now() + interval '24 hours'` },
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
