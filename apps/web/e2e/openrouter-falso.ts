import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

export type TriagemFalsa = {
  itens: {
    servico: string
    tipo: string | null
    unidade: string | null
    data: string | null
    tema: string | null
    // triagem v3 (Etapa 03): campos obrigatórios, null quando não se aplicam
    pessoas: number | null
    horario: string | null
    // triagem v4 (Etapa 04): opcionais aqui; o servidor falso completa com null
    convidados?: number | null
    tipoEvento?: string | null
    espaco?: string | null
    // triagem v5 (Etapa 05): idem
    consulta?: string | null
    tag?: string | null
  }[]
  fora_escopo: boolean
  // triagem v6 (Etapa 06): opcional aqui; o servidor falso completa com false
  frustracao?: boolean
}

/** Leitura de cardápio no formato que o modelo devolve (schema `rascunho_cardapio` de `@atd/ai`). */
export type LeituraCardapioFalsa = {
  categorias: {
    nome: string
    itens: { nome: string; descricao: string | null; precoCentavos: number | null; tags: string[]; unidade: string | null }[]
  }[]
}

/**
 * Servidor local no formato do OpenRouter: responde a triagem por regras fixas e nunca cobra.
 * `responder` recebe a mensagem do cliente e o `user` inteiro (com `<pergunta_pendente>`, quando houver).
 * `leituraCardapio` responde a leitura de PDF/foto da importação (sem ela, a leitura falha com 500); se devolver uma
 * Promise, a resposta espera por ela.
 */
export async function iniciarOpenRouterFalso(
  responder: (mensagem: string, user: string) => TriagemFalsa,
  opcoes: { leituraCardapio?: () => LeituraCardapioFalsa | Promise<LeituraCardapioFalsa> } = {},
) {
  const chamadas: string[] = []
  /** Leituras de cardápio recebidas (PDF pelo motor nativo do modelo?). */
  const leituras: { pdfNativo: boolean }[] = []
  /** `user` completo de cada chamada, na mesma ordem de `chamadas`. */
  const entradas: string[] = []
  const servidor = createServer((req, res) => {
    let corpo = ''
    req.on('data', (c: Buffer) => { corpo += c.toString() })
    req.on('end', () => {
      const responderJson = (status: number, body: unknown) =>
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
      if (req.method !== 'POST' || req.url !== '/chat/completions') return responderJson(404, { error: { message: 'rota desconhecida' } })
      let body: {
        messages: { role: string; content: unknown }[]
        provider?: { data_collection?: string; zdr?: boolean }
        plugins?: { id?: string; pdf?: { engine?: string } }[]
        response_format?: { json_schema?: { name?: string } }
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
      const resposta = (conteudo: unknown) => responderJson(200, {
        model: 'e2e/falso',
        choices: [{ message: { role: 'assistant', content: JSON.stringify(conteudo) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0 },
      })
      // leitura de cardápio (job document.ingest): mesma política de dados, resposta fixa
      if (body.response_format?.json_schema?.name === 'rascunho_cardapio') {
        if (!opcoes.leituraCardapio) return responderJson(500, { error: { message: 'leitura de cardápio não configurada no e2e' } })
        const pdfNativo = (body.plugins ?? []).some((p) => p.id === 'file-parser' && p.pdf?.engine === 'native')
        leituras.push({ pdfNativo })
        // pode ser assíncrona: o teste segura a leitura para ver o estado "Lendo o cardápio…"
        void Promise.resolve(opcoes.leituraCardapio()).then(resposta, (e: unknown) => responderJson(500, { error: { message: String(e) } }))
        return
      }
      const conteudo = body.messages.find((m) => m.role === 'user')?.content
      const user = typeof conteudo === 'string' ? conteudo : ''
      const mensagem = /<mensagem_cliente>\n([\s\S]*)\n<\/mensagem_cliente>/.exec(user)?.[1] ?? user
      chamadas.push(mensagem)
      entradas.push(user)
      const r = responder(mensagem, user)
      const triagem = {
        frustracao: false,
        ...r,
        itens: r.itens.map((i) => ({ convidados: null, tipoEvento: null, espaco: null, consulta: null, tag: null, ...i })),
      }
      return resposta(triagem)
    })
  })
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok))
  const { port } = servidor.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    chamadas,
    entradas,
    leituras,
    fechar: () => new Promise<void>((ok) => servidor.close(() => ok())),
  }
}
