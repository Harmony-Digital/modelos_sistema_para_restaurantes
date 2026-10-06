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

const provider = { data_collection: 'deny', zdr: true }

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
})
