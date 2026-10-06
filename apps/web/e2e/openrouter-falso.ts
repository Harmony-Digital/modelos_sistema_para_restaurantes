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

/** Partes de conteúdo das mensagens (array), para conferir anexos. */
function partes(mensagens: { content: unknown }[]): { type?: string; file?: { file_data?: unknown } }[] {
  return mensagens.flatMap((m) => (Array.isArray(m.content) ? (m.content as { type?: string; file?: { file_data?: unknown } }[]) : []))
}

/**
 * Servidor local no formato do OpenRouter e da OpenAI (`/chat/completions` nos dois): responde a triagem por regras
 * fixas e nunca cobra. O caminho é reconhecido pelo corpo: com `provider` é OpenRouter (exige deny + zdr +
 * require_parameters); sem ele é OpenAI (exige `store: false`, `json_schema` estrito e um `model`, sem campos do
 * OpenRouter) — o e2e roda o worker com `AI_PROVIDER=openai`, o caminho de produção.
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
  /** Provedor de cada chamada aceita (triagem e leitura), na ordem de chegada. */
  const provedores: ('openrouter' | 'openai')[] = []
  const servidor = createServer((req, res) => {
    let corpo = ''
    req.on('data', (c: Buffer) => { corpo += c.toString() })
    req.on('end', () => {
      const responderJson = (status: number, body: unknown) =>
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
      if (req.method !== 'POST' || req.url !== '/chat/completions') return responderJson(404, { error: { message: 'rota desconhecida' } })
      let body: {
        messages: { role: string; content: unknown }[]
        provider?: { data_collection?: string; zdr?: boolean; require_parameters?: boolean }
        plugins?: { id?: string; pdf?: { engine?: string } }[]
        response_format?: { type?: string; json_schema?: { name?: string; strict?: boolean } }
        // OpenAI
        model?: unknown
        models?: unknown
        store?: unknown
      }
      try {
        body = JSON.parse(corpo) as typeof body
      } catch {
        return responderJson(400, { error: { message: 'corpo JSON inválido' } })
      }
      if (!Array.isArray(body?.messages)) return responderJson(400, { error: { message: 'messages ausente' } })
      const openai = body.provider === undefined
      if (openai) {
        // OpenAI (produção): nada guardado do lado deles e saída presa ao esquema
        if (body.store !== false) return responderJson(400, { error: { message: 'chamada sem store: false' } })
        if (typeof body.model !== 'string' || !body.model) return responderJson(400, { error: { message: 'model ausente' } })
        if (body.models !== undefined || body.plugins !== undefined) {
          return responderJson(400, { error: { message: 'campos do OpenRouter (models/plugins) no corpo da OpenAI' } })
        }
        if (body.response_format?.type !== 'json_schema' || body.response_format.json_schema?.strict !== true) {
          return responderJson(400, { error: { message: 'response_format sem json_schema estrito' } })
        }
      } else {
        // a política de dados da LGPD também é conferida aqui
        if (body.provider?.data_collection !== 'deny' || body.provider?.zdr !== true) {
          return responderJson(400, { error: { message: 'chamada sem data_collection deny + zdr' } })
        }
        // e o roteamento só para provedor que honra o json_schema
        if (body.provider.require_parameters !== true) {
          return responderJson(400, { error: { message: 'chamada sem provider.require_parameters' } })
        }
      }
      provedores.push(openai ? 'openai' : 'openrouter')
      // OpenAI: devolve o modelo pedido e usage sem custo (o cliente calcula pela tabela de preços, como em produção)
      const resposta = (conteudo: unknown) => responderJson(200, openai
        ? {
            model: body.model,
            choices: [{ message: { role: 'assistant', content: JSON.stringify(conteudo), refusal: null }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 0 } },
          }
        : {
            model: 'e2e/falso',
            choices: [{ message: { role: 'assistant', content: JSON.stringify(conteudo) } }],
            usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0 },
          })
      // leitura de cardápio (job document.ingest): mesma política de dados, resposta fixa
      if (body.response_format?.json_schema?.name === 'rascunho_cardapio') {
        if (!opcoes.leituraCardapio) return responderJson(500, { error: { message: 'leitura de cardápio não configurada no e2e' } })
        // OpenRouter: plugin file-parser com motor nativo; OpenAI: o PDF vai como parte `file` e o modelo lê direto
        const pdfNativo = openai
          ? partes(body.messages).some((p) => p.type === 'file' && String(p.file?.file_data ?? '').startsWith('data:application/pdf;base64,'))
          : (body.plugins ?? []).some((p) => p.id === 'file-parser' && p.pdf?.engine === 'native')
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
    provedores,
    fechar: () => new Promise<void>((ok) => servidor.close(() => ok())),
  }
}
