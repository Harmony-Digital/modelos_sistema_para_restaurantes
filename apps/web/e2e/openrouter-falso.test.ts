import { afterEach, describe, expect, it } from 'vitest'
// o web não depende de @atd/ai: o teste usa o mesmo parser do worker direto do pacote
import { parseLeituraCardapio } from '../../../packages/ai/src/ingestao.ts'
import { iniciarOpenRouterFalso } from './openrouter-falso'

const LEITURA = {
  categorias: [{ nome: 'Grelhados', itens: [{ nome: 'Costela', descricao: null, precoCentavos: 7990, tags: [], unidade: null }] }],
}

let falso: Awaited<ReturnType<typeof iniciarOpenRouterFalso>> | undefined
afterEach(async () => {
  await falso?.fechar()
  falso = undefined
})

const provider = { data_collection: 'deny', zdr: true, require_parameters: true }

async function post(body: unknown) {
  const r = await fetch(`${falso!.url}/chat/completions`, { method: 'POST', body: JSON.stringify(body) })
  return { status: r.status, json: (await r.json()) as { choices?: { message: { content: string } }[] } }
}

describe('OpenRouter falso do e2e', () => {
  it('responde a leitura de cardápio (rascunho_cardapio) com a leitura fixa, válida pelo schema do rascunho', async () => {
    falso = await iniciarOpenRouterFalso(() => ({ itens: [], fora_escopo: true }), { leituraCardapio: () => LEITURA })
    const { status, json } = await post({
      provider,
      plugins: [{ id: 'file-parser', pdf: { engine: 'native' } }],
      messages: [
        { role: 'system', content: 'Você lê o cardápio…' },
        { role: 'user', content: [{ type: 'text', text: 'O cardápio está no anexo.' }, { type: 'file', file: { filename: 'c.pdf', file_data: 'data:application/pdf;base64,JVBERg==' } }] },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'rascunho_cardapio', strict: true, schema: {} } },
    })
    expect(status).toBe(200)
    const rascunho = parseLeituraCardapio(JSON.parse(json.choices![0]!.message.content))
    expect(rascunho.categorias[0]!.itens[0]).toMatchObject({ nome: 'Costela', precoCentavos: 7990, incluir: true })
    expect(falso.leituras).toEqual([{ pdfNativo: true }])
    // leitura não entra na lista de mensagens da triagem
    expect(falso.chamadas).toEqual([])
  })

  it('sem leitura configurada, a leitura de cardápio falha (500) e a triagem segue funcionando', async () => {
    falso = await iniciarOpenRouterFalso(() => ({ itens: [], fora_escopo: true }))
    const leitura = await post({
      provider, messages: [{ role: 'user', content: [] }],
      response_format: { type: 'json_schema', json_schema: { name: 'rascunho_cardapio' } },
    })
    expect(leitura.status).toBe(500)
    const triagem = await post({ provider, messages: [{ role: 'user', content: '<mensagem_cliente>\noi\n</mensagem_cliente>' }] })
    expect(triagem.status).toBe(200)
    expect(falso.chamadas).toEqual(['oi'])
  })

  it('recusa leitura sem deny + zdr', async () => {
    falso = await iniciarOpenRouterFalso(() => ({ itens: [], fora_escopo: true }), { leituraCardapio: () => LEITURA })
    const { status } = await post({
      messages: [{ role: 'user', content: [] }],
      response_format: { type: 'json_schema', json_schema: { name: 'rascunho_cardapio' } },
    })
    expect(status).toBe(400)
  })

  it('recusa chamada sem require_parameters (provedor sem structured outputs ignoraria o schema)', async () => {
    falso = await iniciarOpenRouterFalso(() => ({ itens: [], fora_escopo: true }))
    const { status } = await post({
      provider: { data_collection: 'deny', zdr: true },
      messages: [{ role: 'user', content: '<mensagem_cliente>\noi\n</mensagem_cliente>' }],
    })
    expect(status).toBe(400)
    expect(falso.chamadas).toEqual([])
  })

  describe('caminho OpenAI (produção: AI_PROVIDER=openai)', () => {
    const openai = { model: 'gpt-4.1-mini', store: false, max_completion_tokens: 100 }
    const schema = (name: string) => ({ type: 'json_schema', json_schema: { name, strict: true, schema: {} } })

    it('triagem: devolve o modelo pedido, finish_reason stop e usage sem custo (o cliente calcula pela tabela)', async () => {
      falso = await iniciarOpenRouterFalso(() => ({ itens: [], fora_escopo: true }))
      const r = await fetch(`${falso.url}/chat/completions`, {
        method: 'POST',
        body: JSON.stringify({ ...openai, messages: [{ role: 'user', content: '<mensagem_cliente>\noi\n</mensagem_cliente>' }], response_format: schema('triagem') }),
      })
      expect(r.status).toBe(200)
      const json = (await r.json()) as { model: string; choices: { finish_reason: string }[]; usage: Record<string, unknown> }
      expect(json.model).toBe('gpt-4.1-mini')
      expect(json.choices[0]!.finish_reason).toBe('stop')
      expect(json.usage).not.toHaveProperty('cost')
      expect(falso.chamadas).toEqual(['oi'])
      expect(falso.provedores).toEqual(['openai'])
    })

    it('leitura de cardápio com PDF como parte file', async () => {
      falso = await iniciarOpenRouterFalso(() => ({ itens: [], fora_escopo: true }), { leituraCardapio: () => LEITURA })
      const { status } = await post({
        ...openai,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'anexo' }, { type: 'file', file: { filename: 'c.pdf', file_data: 'data:application/pdf;base64,JVBERg==' } }] }],
        response_format: schema('rascunho_cardapio'),
      })
      expect(status).toBe(200)
      expect(falso.leituras).toEqual([{ pdfNativo: true }])
      expect(falso.provedores).toEqual(['openai'])
    })

    it('leitura por alvo (Etapa 07): responde pelo nome do schema e registra as partes de cada lote', async () => {
      const pedidos: unknown[] = []
      falso = await iniciarOpenRouterFalso(() => ({ itens: [], fora_escopo: true }), {
        leituraDocumento: (p) => {
          pedidos.push(p)
          return { fatos: [{ tema: 'Estacionamento', texto: 'Gratuito.', exemplos: [], unidade: null }] }
        },
      })
      const { status, json } = await post({
        ...openai,
        messages: [{ role: 'user', content: [
          { type: 'text', text: 'anexo' },
          { type: 'file', file: { filename: 'documento-1-paginas-1-a-5.pdf', file_data: 'data:application/pdf;base64,JVBERg==' } },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw==' } },
        ] }],
        response_format: schema('rascunho_informacoes'),
      })
      expect(status).toBe(200)
      expect(JSON.parse(json.choices![0]!.message.content)).toEqual({ fatos: [{ tema: 'Estacionamento', texto: 'Gratuito.', exemplos: [], unidade: null }] })
      const esperado = { schema: 'rascunho_informacoes', partes: [{ tipo: 'pdf', nome: 'documento-1-paginas-1-a-5.pdf' }, { tipo: 'imagem', nome: null }] }
      expect(pedidos).toEqual([esperado])
      expect(falso.documentos).toEqual([esperado])
      // a leitura não entra na triagem
      expect(falso.chamadas).toEqual([])
    })

    it('rascunho_cardapio usa leituraDocumento quando não há leituraCardapio; sem nenhuma, 500', async () => {
      falso = await iniciarOpenRouterFalso(() => ({ itens: [], fora_escopo: true }), { leituraDocumento: () => LEITURA })
      const ok = await post({ ...openai, messages: [{ role: 'user', content: 'x' }], response_format: schema('rascunho_cardapio') })
      expect(ok.status).toBe(200)
      expect(falso.documentos).toEqual([{ schema: 'rascunho_cardapio', partes: [] }])
      await falso.fechar()
      falso = await iniciarOpenRouterFalso(() => ({ itens: [], fora_escopo: true }))
      const semLeitura = await post({ ...openai, messages: [{ role: 'user', content: 'x' }], response_format: schema('rascunho_espacos') })
      expect(semLeitura.status).toBe(500)
    })

    it('recusa chamada sem store:false (OpenAI guardaria a conversa)', async () => {
      falso = await iniciarOpenRouterFalso(() => ({ itens: [], fora_escopo: true }))
      const { status } = await post({ model: 'gpt-4.1-mini', messages: [{ role: 'user', content: 'x' }], response_format: schema('triagem') })
      expect(status).toBe(400)
      expect(falso.chamadas).toEqual([])
    })

    it('recusa json_schema sem strict e campos do OpenRouter no corpo da OpenAI', async () => {
      falso = await iniciarOpenRouterFalso(() => ({ itens: [], fora_escopo: true }))
      const semStrict = await post({ ...openai, messages: [{ role: 'user', content: 'x' }], response_format: { type: 'json_schema', json_schema: { name: 'triagem', schema: {} } } })
      expect(semStrict.status).toBe(400)
      const comModels = await post({ ...openai, models: ['a', 'b'], messages: [{ role: 'user', content: 'x' }], response_format: schema('triagem') })
      expect(comModels.status).toBe(400)
      expect(falso.chamadas).toEqual([])
    })
  })
})
