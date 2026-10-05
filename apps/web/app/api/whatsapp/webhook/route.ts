import type { NextRequest } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { enqueueProcess, getSingleRestaurantId } from '@atd/db'
import { verifyChallenge } from '@atd/whatsapp'
import { handleWebhookPost } from '@/lib/webhook'
import { getBoss } from '@/lib/server/boss'
import { getDb } from '@/lib/server/db'
import { env } from '@/lib/server/env'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET(req: NextRequest) {
  const challenge = verifyChallenge(req.nextUrl.searchParams, env().WHATSAPP_VERIFY_TOKEN)
  return challenge
    ? new Response(challenge, { status: 200, headers: { 'content-type': 'text/plain' } })
    : new Response('forbidden', { status: 403 })
}

const MAX_BODY = 1_000_000

export async function POST(req: NextRequest) {
  const declared = Number(req.headers.get('content-length') ?? 0)
  if (declared > MAX_BODY) return new Response('payload grande demais', { status: 413 })
  const raw = Buffer.from(await req.arrayBuffer())
  if (raw.byteLength > MAX_BODY) return new Response('payload grande demais', { status: 413 })

  const e = env()
  const db = getDb()
  const result = await handleWebhookPost(
    {
      db,
      // Só abre conexão do pg-boss depois da assinatura válida e quando há mensagem a enfileirar.
      enqueue: async (tx, conversationId) => enqueueProcess(await getBoss())(tx, conversationId),
      appSecret: e.WHATSAPP_APP_SECRET,
      phoneNumberId: e.WHATSAPP_PHONE_NUMBER_ID,
      phoneKey: e.phoneKey,
      pepper: e.pepper,
      restaurantId: async () => e.RESTAURANT_ID ?? getSingleRestaurantId(db),
      onInvalidPayload: (err) => Sentry.captureException(err, { tags: { area: 'webhook' } }),
    },
    raw,
    req.headers.get('x-hub-signature-256'),
  )
  return new Response(result.body, { status: result.status })
}
