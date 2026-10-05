import { z } from 'zod'

const media = z.looseObject({ id: z.string(), caption: z.string().optional() })

const message = z.looseObject({
  id: z.string(),
  from: z.string(),
  timestamp: z.string(),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  audio: media.optional(),
  image: media.optional(),
  document: media.optional(),
  button: z.looseObject({ text: z.string() }).optional(),
})

const status = z.looseObject({
  id: z.string(),
  status: z.string(),
  timestamp: z.string(),
  errors: z.array(z.looseObject({ code: z.number() })).optional(),
})

const payload = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(
    z.object({
      id: z.string(),
      changes: z.array(
        z.object({
          field: z.string(),
          value: z.looseObject({
            metadata: z.looseObject({ phone_number_id: z.string() }),
            contacts: z.array(z.looseObject({ wa_id: z.string(), profile: z.looseObject({ name: z.string() }).optional() })).optional(),
            messages: z.array(message).optional(),
            statuses: z.array(status).optional(),
          }),
        }),
      ),
    }),
  ),
})

export type InboundMessage = {
  wamid: string
  waId: string
  profileName: string | null
  timestamp: Date
  tipo: 'texto' | 'audio' | 'imagem' | 'documento' | 'outro'
  texto: string | null
  mediaId: string | null
}

export type StatusUpdate = { wamid: string; status: string; timestamp: Date; errorCode: number | null }

const toDate = (unixSeconds: string) => new Date(Number(unixSeconds) * 1000)

function toInbound(m: z.infer<typeof message>, profileName: string | null): InboundMessage {
  const base = { wamid: m.id, waId: m.from, profileName, timestamp: toDate(m.timestamp) }
  switch (m.type) {
    case 'text':
      return { ...base, tipo: 'texto', texto: m.text?.body ?? null, mediaId: null }
    case 'button':
      return { ...base, tipo: 'texto', texto: m.button?.text ?? null, mediaId: null }
    case 'audio':
      return { ...base, tipo: 'audio', texto: null, mediaId: m.audio?.id ?? null }
    case 'image':
      return { ...base, tipo: 'imagem', texto: m.image?.caption ?? null, mediaId: m.image?.id ?? null }
    case 'document':
      return { ...base, tipo: 'documento', texto: m.document?.caption ?? null, mediaId: m.document?.id ?? null }
    default:
      return { ...base, tipo: 'outro', texto: null, mediaId: null }
  }
}

export function parseWebhook(body: unknown, phoneNumberId: string) {
  const parsed = payload.parse(body)
  const inbound: InboundMessage[] = []
  const statuses: StatusUpdate[] = []
  for (const entry of parsed.entry) {
    for (const change of entry.changes) {
      const v = change.value
      if (change.field !== 'messages' || v.metadata.phone_number_id !== phoneNumberId) continue
      const names = new Map((v.contacts ?? []).map((c) => [c.wa_id, c.profile?.name ?? null]))
      for (const m of v.messages ?? []) inbound.push(toInbound(m, names.get(m.from) ?? null))
      for (const s of v.statuses ?? []) {
        statuses.push({ wamid: s.id, status: s.status, timestamp: toDate(s.timestamp), errorCode: s.errors?.[0]?.code ?? null })
      }
    }
  }
  return { inbound, statuses }
}
