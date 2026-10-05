import { encryptPhone, hashWaId, normalizeWaId, redactPii, stripQueryParams } from '@atd/core'
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
  /** Falha ao gravar (banco etc.): o caller manda ao Sentry (já com scrub). */
  onError?: (e: unknown) => void
}

/**
 * Erros do drizzle trazem "\nparams: ..." com texto, nome de perfil e telefone cifrado do cliente.
 * Nunca deixar o erro bruto chegar ao stdout (logs da Vercel): só a mensagem sem params e mascarada.
 */
export function reportWebhookError(err: unknown, capture?: (e: unknown) => void) {
  capture?.(err)
  const message = err instanceof Error ? err.message : String(err)
  // eslint-disable-next-line no-console -- única saída no stdout da Vercel, já sem params e com PII mascarada
  console.error(`webhook: falha ao processar: ${redactPii(stripQueryParams(message)).slice(0, 2000)}`)
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

  try {
    await persist(deps, events)
  } catch (err) {
    reportWebhookError(err, deps.onError)
    // 500: a Meta reentrega; a ingestão é idempotente por wamid.
    return { status: 500, body: 'erro interno' }
  }
  return { status: 200, body: 'ok' }
}

async function persist(deps: WebhookDeps, events: ReturnType<typeof parseWebhook>) {
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
}
