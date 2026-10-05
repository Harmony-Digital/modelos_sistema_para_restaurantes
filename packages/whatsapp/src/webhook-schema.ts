import { z } from 'zod'

const media = z.looseObject({ id: z.string(), caption: z.string().optional() })

const unixSeconds = z.string().regex(/^\d+$/)

const message = z.looseObject({
  id: z.string(),
  from: z.string(),
  timestamp: unixSeconds,
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  audio: media.optional(),
  image: media.optional(),
  document: media.optional(),
  button: z.looseObject({ text: z.string() }).optional(),
  interactive: z
    .looseObject({
      button_reply: z.looseObject({ id: z.string().optional(), title: z.string() }).optional(),
      list_reply: z.looseObject({ id: z.string().optional(), title: z.string() }).optional(),
    })
    .optional(),
})

const status = z.looseObject({
  id: z.string(),
  status: z.string(),
  timestamp: unixSeconds,
  errors: z.array(z.looseObject({ code: z.number() })).optional(),
})

const messagesValue = z.looseObject({
  metadata: z.looseObject({ phone_number_id: z.string() }),
  contacts: z
    .array(z.looseObject({ wa_id: z.string(), profile: z.looseObject({ name: z.string() }).optional() }))
    .optional(),
  messages: z.array(z.unknown()).optional(),
  statuses: z.array(z.unknown()).optional(),
})

const payload = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(
    z.object({
      id: z.string(),
      changes: z.array(z.object({ field: z.string(), value: z.record(z.string(), z.unknown()) })),
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
  /** id da linha/botão escolhido numa resposta interativa */
  interativoId: string | null
}

export type StatusUpdate = { wamid: string; status: string; timestamp: Date; errorCode: number | null }

// Postgres rejeita NUL em text; remove de tudo que vira texto persistido.
const clean = (v: string | null | undefined): string | null => (v == null ? null : v.replaceAll('\u0000', ''))

const toDate = (unixSeconds: string) => new Date(Number(unixSeconds) * 1000)

function toInbound(m: z.infer<typeof message>, rawProfileName: string | null): InboundMessage {
  const profileName = clean(rawProfileName)
  const base = { wamid: m.id, waId: m.from, profileName, timestamp: toDate(m.timestamp), interativoId: null }
  switch (m.type) {
    case 'text':
      return { ...base, tipo: 'texto', texto: clean(m.text?.body), mediaId: null }
    case 'button':
      return { ...base, tipo: 'texto', texto: clean(m.button?.text), mediaId: null }
    case 'interactive':
      return {
        ...base,
        tipo: 'texto',
        texto: clean(m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title),
        interativoId: clean(m.interactive?.list_reply?.id ?? m.interactive?.button_reply?.id),
        mediaId: null,
      }
    case 'audio':
      return { ...base, tipo: 'audio', texto: null, mediaId: m.audio?.id ?? null }
    case 'image':
      return { ...base, tipo: 'imagem', texto: clean(m.image?.caption), mediaId: m.image?.id ?? null }
    case 'document':
      return { ...base, tipo: 'documento', texto: clean(m.document?.caption), mediaId: m.document?.id ?? null }
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
      if (change.field !== 'messages') continue
      const value = messagesValue.safeParse(change.value)
      if (!value.success || value.data.metadata.phone_number_id !== phoneNumberId) continue
      const v = value.data
      const names = new Map((v.contacts ?? []).map((c) => [c.wa_id, c.profile?.name ?? null]))
      for (const raw of v.messages ?? []) {
        const m = message.safeParse(raw)
        if (m.success) inbound.push(toInbound(m.data, names.get(m.data.from) ?? null))
      }
      for (const raw of v.statuses ?? []) {
        const s = status.safeParse(raw)
        if (!s.success) continue
        statuses.push({
          wamid: s.data.id,
          status: s.data.status,
          timestamp: toDate(s.data.timestamp),
          errorCode: s.data.errors?.[0]?.code ?? null,
        })
      }
    }
  }
  return { inbound, statuses }
}
