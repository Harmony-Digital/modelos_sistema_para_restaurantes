import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

export type TriagemFalsa = {
  itens: { servico: string; tipo: string | null; unidade: string | null; data: string | null; tema: string | null }[]
  fora_escopo: boolean
}

/** Servidor local no formato do OpenRouter: responde a triagem por regras fixas e nunca cobra. */
export async function iniciarOpenRouterFalso(responder: (mensagem: string) => TriagemFalsa) {
  const chamadas: string[] = []
  const servidor = createServer((req, res) => {
    let corpo = ''
    req.on('data', (c: Buffer) => { corpo += c.toString() })
    req.on('end', () => {
      const responderJson = (status: number, body: unknown) =>
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
      if (req.method !== 'POST' || req.url !== '/chat/completions') return responderJson(404, { error: { message: 'rota desconhecida' } })
      let body: {
        messages: { role: string; content: string }[]
        provider?: { data_collection?: string; zdr?: boolean }
      }
      try {
        body = JSON.parse(corpo) as typeof body
      } catch {
        return responderJson(400, { error: { message: 'corpo JSON inválido' } })
      }
      if (!Array.isArray(body?.messages)) return responderJson(400, { error: { message: 'messages ausente' } })
      // a política de dados da LGPD também é conferida aqui
      if (body.provider?.data_collection !== 'deny' || body.provider?.zdr !== true) {
        return responderJson(400, { error: { message: 'chamada sem data_collection deny + zdr' } })
      }
      const user = body.messages.find((m) => m.role === 'user')?.content ?? ''
      const mensagem = /<mensagem_cliente>\n([\s\S]*)\n<\/mensagem_cliente>/.exec(user)?.[1] ?? user
      chamadas.push(mensagem)
      return responderJson(200, {
        model: 'e2e/falso',
        choices: [{ message: { role: 'assistant', content: JSON.stringify(responder(mensagem)) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0 },
      })
    })
  })
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok))
  const { port } = servidor.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    chamadas,
    fechar: () => new Promise<void>((ok) => servidor.close(() => ok())),
  }
}
