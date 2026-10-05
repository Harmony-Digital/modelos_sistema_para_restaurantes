export type SendResult =
  | { ok: true; wamid: string }
  | { ok: false; retryable: boolean; code: number | null; message: string }

// Códigos de throttling da Cloud API: tentar de novo com backoff
const RETRYABLE_CODES = new Set([4, 80007, 130429, 131048, 131056, 133016])
const MAX_TEXT = 4096

export function createWhatsAppClient(cfg: {
  accessToken: string
  phoneNumberId: string
  graphVersion: string
  fetch?: typeof fetch
  timeoutMs?: number
}) {
  const doFetch = cfg.fetch ?? fetch
  const url = `https://graph.facebook.com/${cfg.graphVersion}/${cfg.phoneNumberId}/messages`

  async function post(payload: Record<string, unknown>): Promise<SendResult> {
    let res: Response
    try {
      res = await doFetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...payload }),
        signal: AbortSignal.timeout(cfg.timeoutMs ?? 10_000),
      })
    } catch (e) {
      return { ok: false, retryable: true, code: null, message: e instanceof Error ? e.message : 'erro de rede' }
    }
    const body = (await res.json().catch(() => ({}))) as {
      messages?: { id: string }[]
      error?: { code?: number; message?: string }
    }
    const wamid = body.messages?.[0]?.id
    if (res.ok && wamid) return { ok: true, wamid }
    const code = body.error?.code ?? null
    const retryable = res.status >= 500 || res.status === 429 || (code !== null && RETRYABLE_CODES.has(code))
    return { ok: false, retryable, code, message: body.error?.message ?? `HTTP ${res.status}` }
  }

  return {
    sendText(to: string, text: string) {
      return post({ to, type: 'text', text: { preview_url: false, body: text.slice(0, MAX_TEXT) } })
    },
  }
}

export type WhatsAppClient = ReturnType<typeof createWhatsAppClient>
