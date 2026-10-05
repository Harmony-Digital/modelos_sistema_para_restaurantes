import { encryptPhone, hashWaId, normalizeWaId } from '@atd/core'
import { applyStatus, ingestInbound, type Db, type Enqueue } from '@atd/db'
import { parseWebhook, verifySignature } from '@atd/whatsapp'

export type WebhookDeps = {
  db: Db
  enqueue: Enqueue
  appSecret: string
  phoneNumberId: string
  phoneKey: Buffer
  pepper: Buffer
  restaurantId: () => Promise<string>
  onInvalidPayload?: (e: unknown) => void
}

const MAX_BODY = 1_000_000

export async function handleWebhookPost(deps: WebhookDeps, raw: Buffer | string, signature: string | null) {
  if (Buffer.byteLength(raw) > MAX_BODY) return { status: 413, body: 'payload grande demais' }
  if (!verifySignature(raw, signature, deps.appSecret)) return { status: 401, body: 'assinatura inválida' }

  let events: ReturnType<typeof parseWebhook>
  let json: unknown
  try {
    json = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'))
  } catch {
    // O erro original cita trechos do corpo: reportar só um erro genérico.
    deps.onInvalidPayload?.(new Error('payload do webhook fora do formato'))
    return { status: 200, body: 'ignorado' }
  }
  try {
    events = parseWebhook(json, deps.phoneNumberId)
  } catch (e) {
    // Assinado pela Meta mas fora do formato esperado: registrar e não pedir reentrega.
    deps.onInvalidPayload?.(e)
    return { status: 200, body: 'ignorado' }
  }

  for (const s of events.statuses) await applyStatus(deps.db, s)
  if (events.inbound.length > 0) {
    const restaurantId = await deps.restaurantId()
    for (const m of events.inbound) {
      const waId = normalizeWaId(m.waId)
      await ingestInbound(
        deps.db,
        {
          restaurantId,
          waIdHash: hashWaId(waId, deps.pepper),
          telefoneCifrado: encryptPhone(waId, deps.phoneKey),
          profileName: m.profileName,
          wamid: m.wamid,
          tipo: m.tipo,
          texto: m.texto,
          mediaId: m.mediaId,
          timestamp: m.timestamp,
        },
        deps.enqueue,
      )
    }
  }
  return { status: 200, body: 'ok' }
}
