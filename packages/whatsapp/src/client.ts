export type SendResult =
  | { ok: true; wamid: string }
  | { ok: false; retryable: boolean; code: number | null; message: string }

// Códigos de throttling da Cloud API: tentar de novo com backoff
const RETRYABLE_CODES = new Set([4, 80007, 130429, 131016, 131048, 131056, 133016])
const MAX_TEXT = 4096

// Corta em `max` unidades sem partir um par substituto (emoji)
function truncate(text: string, max = MAX_TEXT): string {
  if (text.length <= max) return text
  const code = text.charCodeAt(max - 1)
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max)
}

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
      return post({ to, type: 'text', text: { preview_url: false, body: truncate(text) } })
    },
    sendLocation(to: string, loc: { lat: number; lng: number; nome: string; endereco: string }) {
      return post({
        to,
        type: 'location',
        location: { latitude: loc.lat, longitude: loc.lng, name: truncate(loc.nome, 100), address: truncate(loc.endereco, 300) },
      })
    },
    // Limites da Meta: corpo 1024, botão 20, título de linha 24, descrição 72, até 10 linhas no total
    sendList(to: string, l: { corpo: string; botao: string; opcoes: { id: string; titulo: string; descricao: string }[] }) {
      return post({
        to,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: truncate(l.corpo, 1024) },
          action: {
            button: truncate(l.botao, 20),
            sections: [{
              title: 'Unidades',
              rows: l.opcoes.slice(0, 10).map((o) => ({
                id: o.id.slice(0, 200),
                title: truncate(o.titulo, 24),
                ...(o.descricao ? { description: truncate(o.descricao, 72) } : {}),
              })),
            }],
          },
        },
      })
    },
  }
}

export type WhatsAppClient = ReturnType<typeof createWhatsAppClient>
