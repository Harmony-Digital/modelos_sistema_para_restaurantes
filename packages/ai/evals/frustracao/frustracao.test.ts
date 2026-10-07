import { describe, expect, it, vi } from 'vitest'
import { createOpenRouterClient } from '../../src/openrouter.ts'
import { CASOS_FRUSTRACAO, type CasoFrustracao } from './casos.ts'
import { rodarFrustracao } from './extracao.ts'

/** OpenRouter falso: devolve a frustração que `decidir` mandar para a mensagem do cliente. */
function fetchFalso(decidir: (mensagem: string) => boolean | 'erro', custo = 0.0001) {
  const corpos: Record<string, unknown>[] = []
  const fn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init!.body)) as { messages: { content: string }[] }
    corpos.push(body)
    const user = body.messages[1]!.content
    const mensagem = /<mensagem_cliente>\n([\s\S]*)\n<\/mensagem_cliente>/.exec(user)![1]!
    const d = decidir(mensagem)
    if (d === 'erro') return new Response(JSON.stringify({ error: { message: 'falhou' } }), { status: 500 })
    const content = JSON.stringify({ itens: [], fora_escopo: false, frustracao: d })
    return new Response(JSON.stringify({ model: 'm', choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: custo } }), { status: 200 })
  })
  return { fn: fn as unknown as typeof fetch, corpos }
}
const llmCom = (f: typeof fetch) => createOpenRouterClient({ apiKey: 'k', appTitle: 't', fetch: f })
const esperado = new Map(CASOS_FRUSTRACAO.map((c) => [c.mensagem, c.frustracao]))

describe('gabarito de frustração', () => {
  it('≥ 10 com frustração e ≥ 10 parecidas sem, ids únicos, com pendente nos dois lados', () => {
    expect(CASOS_FRUSTRACAO.filter((c) => c.frustracao).length).toBeGreaterThanOrEqual(10)
    expect(CASOS_FRUSTRACAO.filter((c) => !c.frustracao).length).toBeGreaterThanOrEqual(10)
    expect(new Set(CASOS_FRUSTRACAO.map((c) => c.id)).size).toBe(CASOS_FRUSTRACAO.length)
    expect(CASOS_FRUSTRACAO.some((c) => c.pendente && c.frustracao)).toBe(true)
    expect(CASOS_FRUSTRACAO.some((c) => c.pendente && !c.frustracao)).toBe(true)
    expect(CASOS_FRUSTRACAO.find((c) => c.mensagem.startsWith('que demora pra abrir, hein?'))?.frustracao).toBe(false)
  })
})

describe('rodarFrustracao (camada 1 com fetch falso)', () => {
  it('modelo que acerta tudo passa no gate; chama a triage-v7 com deny + zdr', async () => {
    const f = fetchFalso((m) => esperado.get(m)!)
    const r = await rodarFrustracao({ llm: llmCom(f.fn), modelos: ['m'], teto: 1, maxChamadas: 100, hoje: '2026-10-06' })
    expect(r.motivos).toEqual([])
    expect(r.relatorio).toContain(`| m | ${CASOS_FRUSTRACAO.length}/${CASOS_FRUSTRACAO.length} (100.0%) | 0 | 0 |`)
    expect(f.corpos).toHaveLength(CASOS_FRUSTRACAO.length)
    expect(f.corpos[0]).toMatchObject({ provider: { data_collection: 'deny', zdr: true }, response_format: { json_schema: { name: 'triagem_v7' } } })
    // pendente vai junto
    expect(f.corpos.some((c) => JSON.stringify(c).includes('pergunta_pendente'))).toBe(true)
  })

  it('dois falsos positivos reprovam mesmo com acerto alto', async () => {
    const fps = new Set(CASOS_FRUSTRACAO.filter((c) => !c.frustracao).slice(0, 2).map((c) => c.mensagem))
    const f = fetchFalso((m) => fps.has(m) || esperado.get(m)!)
    const r = await rodarFrustracao({ llm: llmCom(f.fn), modelos: ['m'], teto: 1, maxChamadas: 100 })
    expect(r.motivos).toHaveLength(1)
    expect(r.motivos[0]).toContain('2 falso(s) positivo(s)')
    expect(r.relatorio).toContain('REPROVADO')
  })

  it('falha da chamada conta como erro e derruba o acerto', async () => {
    const casos: CasoFrustracao[] = [{ id: 'a', mensagem: 'x', frustracao: true }, { id: 'b', mensagem: 'y', frustracao: false }]
    const f = fetchFalso((m) => (m === 'x' ? 'erro' : false))
    const r = await rodarFrustracao({ llm: llmCom(f.fn), modelos: ['m'], teto: 1, maxChamadas: 100, casos })
    expect(r.relatorio).toContain('- a: falha da chamada')
    expect(r.motivos[0]).toContain('m: 1/2')
  })

  it('teto e limite de chamadas param a execução e reprovam', async () => {
    const f = fetchFalso((m) => esperado.get(m)!, 0.3)
    const r = await rodarFrustracao({ llm: llmCom(f.fn), modelos: ['a', 'b'], teto: 0.5, maxChamadas: 100 })
    expect(f.corpos).toHaveLength(2)
    expect(r.motivos.some((m) => m.includes('teto de US$ 0.50'))).toBe(true)
    const g = fetchFalso((m) => esperado.get(m)!)
    const r2 = await rodarFrustracao({ llm: llmCom(g.fn), modelos: ['a'], teto: 1, maxChamadas: 3 })
    expect(g.corpos).toHaveLength(3)
    expect(r2.motivos.some((m) => m.includes('limite de 3 chamadas'))).toBe(true)
  })
})
