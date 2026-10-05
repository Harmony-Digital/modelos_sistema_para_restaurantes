import type { NextRequest } from 'next/server'
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

export async function POST(req: NextRequest) {
  const e = env()
  const db = getDb()
  const raw = await req.text()
  const result = await handleWebhookPost(
    {
      db,
      enqueue: enqueueProcess(await getBoss()),
      appSecret: e.WHATSAPP_APP_SECRET,
      phoneNumberId: e.WHATSAPP_PHONE_NUMBER_ID,
      phoneKey: e.phoneKey,
      pepper: e.pepper,
      restaurantId: async () => e.RESTAURANT_ID ?? getSingleRestaurantId(db),
      onInvalidPayload: () => console.warn('[webhook] payload assinado fora do formato esperado'), // eslint-disable-line no-console
    },
    raw,
    req.headers.get('x-hub-signature-256'),
  )
  return new Response(result.body, { status: result.status })
}
