import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createOpenAiClient } from './openai.ts'
import type { ConteudoUsuario } from './openrouter.ts'
import { ingestaoJsonSchema } from './prompts/ingestao-cardapio-v1.ts'
import { triageJsonSchema } from './prompts/triage-v1.ts'
import { triageV2JsonSchema } from './prompts/triage-v2.ts'
import { triageV3JsonSchema } from './prompts/triage-v3.ts'
import { triageV4JsonSchema } from './prompts/triage-v4.ts'
import { triageV5JsonSchema } from './prompts/triage-v5.ts'
import { triageV6JsonSchema } from './prompts/triage-v6.ts'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const ok = (content: string | null, extra: { model?: string; finish?: string; refusal?: string; usage?: unknown } = {}) =>
  json(200, {
    id: 'chatcmpl-1',
    object: 'chat.completion',
    model: extra.model ?? 'gpt-4.1-mini-2025-04-14',
    choices: [{ index: 0, message: { role: 'assistant', content, refusal: extra.refusal ?? null }, finish_reason: extra.finish ?? 'stop' }],
    usage: extra.usage ?? { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500, prompt_tokens_details: { cached_tokens: 200 } },
  })

type Chamada = { url: string; init: RequestInit; body: Record<string, unknown> }

function fetchFalso(respostas: Array<Response | Error | ((init: RequestInit) => Promise<Response>)>) {
  const chamadas: Chamada[] = []
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const i = init ?? {}
    chamadas.push({ url: String(url), init: i, body: JSON.parse(String(i.body)) as Record<string, unknown> })
    const r = respostas.shift()
    if (!r) throw new Error('sem resposta configurada')
    if (r instanceof Error) throw r
    if (typeof r === 'function') return r(i)
    return r
  })
  return { f: f as unknown as typeof fetch, chamadas }
}

const schema = z.object({ intencao: z.string() })
const base = {
  models: ['gpt-4.1-mini', 'gpt-4.1'],
  system: 'sistema',
  user: 'oi',
  schemaName: 'triagem',
  jsonSchema: { type: 'object', properties: { intencao: { type: 'string' } }, required: ['intencao'], additionalProperties: false },
  parse: (raw: unknown) => schema.parse(raw),
  maxTokens: 300,
}

const cliente = (f: typeof fetch, extra: { baseUrl?: string; timeoutMs?: number } = {}) =>
  createOpenAiClient({ apiKey: 'sk-teste', fetch: f, ...extra })

afterEach(() => vi.restoreAllMocks())

describe('cliente da OpenAI: corpo da requisição', () => {
  it('POST /chat/completions com store:false, json_schema strict e max_completion_tokens; sem campos do OpenRouter', async () => {
    const { f, chamadas } = fetchFalso([ok('{"intencao":"horario"}')])
    await cliente(f).completeJson(base)
    expect(chamadas).toHaveLength(1)
    const c = chamadas[0]!
    expect(c.url).toBe('https://api.openai.com/v1/chat/completions')
    expect(c.init.method).toBe('POST')
    expect((c.init.headers as Record<string, string>).Authorization).toBe('Bearer sk-teste')
    expect(c.body).toMatchObject({
      model: 'gpt-4.1-mini',
      store: false,
      max_completion_tokens: 300,
      stream: false,
      messages: [
        { role: 'system', content: 'sistema' },
        { role: 'user', content: 'oi' },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'triagem', strict: true, schema: base.jsonSchema } },
    })
    for (const k of ['provider', 'plugins', 'models', 'max_tokens', 'reasoning', 'reasoning_effort']) expect(c.body).not.toHaveProperty(k)
  })

  it('baseUrl configurável (servidor falso), sem barra duplicada', async () => {
    const { f, chamadas } = fetchFalso([ok('{"intencao":"x"}')])
    await cliente(f, { baseUrl: 'http://127.0.0.1:9999/v1/' }).completeJson(base)
    expect(chamadas[0]!.url).toBe('http://127.0.0.1:9999/v1/chat/completions')
  })

  it('imagem vai como image_url com data URL; PDF como parte file com file_data; texto primeiro', async () => {
    const { f, chamadas } = fetchFalso([ok('{"intencao":"x"}')])
    const partes: ConteudoUsuario[] = [
      { type: 'image', mime: 'image/png', base64: 'AAAA' },
      { type: 'pdf', filename: 'cardapio.pdf', base64: 'JVBE' },
      { type: 'text', text: 'extra' },
    ]
    await cliente(f).completeJson({ ...base, user: 'leia', userParts: partes })
    const msgs = chamadas[0]!.body.messages as Array<{ role: string; content: unknown }>
    expect(msgs[1]!.content).toEqual([
      { type: 'text', text: 'leia' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      { type: 'file', file: { filename: 'cardapio.pdf', file_data: 'data:application/pdf;base64,JVBE' } },
      { type: 'text', text: 'extra' },
    ])
    expect(chamadas[0]!.body).not.toHaveProperty('plugins')
  })

  it('modelo de raciocínio (gpt-5*, o*) recebe esforço mínimo e não recebe temperature; demais recebem temperature 0', async () => {
    const { f, chamadas } = fetchFalso([ok('{"intencao":"x"}'), ok('{"intencao":"x"}'), ok('{"intencao":"x"}'), ok('{"intencao":"x"}')])
    await cliente(f).completeJson({ ...base, models: ['gpt-5-mini'] })
    await cliente(f).completeJson({ ...base, models: ['o4-mini'] })
    await cliente(f).completeJson({ ...base, models: ['gpt-4.1-mini'] })
    await cliente(f).completeJson({ ...base, models: ['gpt-5-nano'], reasoning: true })
    expect(chamadas[0]!.body.reasoning_effort).toBe('minimal')
    expect(chamadas[0]!.body).not.toHaveProperty('temperature')
    expect(chamadas[1]!.body.reasoning_effort).toBe('low')
    expect(chamadas[1]!.body).not.toHaveProperty('temperature')
    expect(chamadas[2]!.body).not.toHaveProperty('reasoning_effort')
    expect(chamadas[2]!.body.temperature).toBe(0)
    // reasoning: true ⇒ o modelo decide (sem o campo)
    expect(chamadas[3]!.body).not.toHaveProperty('reasoning_effort')
  })

  it('gpt-5.x (sem "minimal") recebe "none"', async () => {
    const { f, chamadas } = fetchFalso([ok('{"intencao":"x"}')])
    await cliente(f).completeJson({ ...base, models: ['gpt-5.1-mini'] })
    expect(chamadas[0]!.body.reasoning_effort).toBe('none')
  })
})

describe('cliente da OpenAI: resultado', () => {
  it('sucesso: data validada pelo parse, model devolvido, usage com cache e custo pela tabela', async () => {
    const { f } = fetchFalso([ok('{"intencao":"horario"}')])
    const r = await cliente(f).completeJson(base)
    expect(r).toMatchObject({
      ok: true,
      data: { intencao: 'horario' },
      model: 'gpt-4.1-mini-2025-04-14',
      usage: { tokensIn: 1000, tokensOut: 500, tokensCache: 200, costUsd: '0.001140' },
    })
    expect(r.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('sem model na resposta: usa o pedido; modelo fora da tabela ⇒ costUsd null', async () => {
    const { f } = fetchFalso([
      json(200, { choices: [{ message: { content: '{"intencao":"x"}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 5 } }),
    ])
    const r = await cliente(f).completeJson({ ...base, models: ['gpt-desconhecido'] })
    expect(r).toMatchObject({ ok: true, model: 'gpt-desconhecido', usage: { tokensIn: 5, tokensOut: 5, tokensCache: 0, costUsd: null } })
  })

  it('refusal ⇒ saida_invalida, com usage e custo (a chamada foi paga)', async () => {
    const { f, chamadas } = fetchFalso([ok(null, { refusal: 'Não posso ajudar com isso.' })])
    const r = await cliente(f).completeJson(base)
    expect(r).toMatchObject({ ok: false, error: 'saida_invalida', retryable: true, status: 200, usage: { costUsd: '0.001140' } })
    expect(chamadas).toHaveLength(1)
  })

  it('JSON inválido ou fora do esquema ⇒ saida_invalida, sem tentar o próximo modelo', async () => {
    const a = fetchFalso([ok('não é json')])
    expect(await cliente(a.f).completeJson(base)).toMatchObject({ ok: false, error: 'saida_invalida' })
    expect(a.chamadas).toHaveLength(1)
    const b = fetchFalso([ok('{"outra":1}')])
    expect(await cliente(b.f).completeJson(base)).toMatchObject({ ok: false, error: 'saida_invalida' })
    expect(b.chamadas).toHaveLength(1)
  })

  it('finish_reason length ⇒ saida_truncada, não repete nem tenta o próximo', async () => {
    const { f, chamadas } = fetchFalso([ok('{"intencao":"hor', { finish: 'length' })])
    const r = await cliente(f).completeJson(base)
    expect(r).toMatchObject({ ok: false, error: 'saida_truncada', retryable: false })
    expect(chamadas).toHaveLength(1)
  })
})

describe('cliente da OpenAI: reserva entre modelos', () => {
  it.each([429, 500, 503])('HTTP %i no primeiro ⇒ tenta o segundo', async (status) => {
    const { f, chamadas } = fetchFalso([json(status, { error: { message: 'tente depois', type: 'x' } }), ok('{"intencao":"x"}', { model: 'gpt-4.1-2025-04-14' })])
    const r = await cliente(f).completeJson(base)
    expect(r).toMatchObject({ ok: true, model: 'gpt-4.1-2025-04-14' })
    expect(chamadas.map((c) => c.body.model)).toEqual(['gpt-4.1-mini', 'gpt-4.1'])
  })

  it('timeout/erro de rede no primeiro ⇒ tenta o segundo', async () => {
    const { f, chamadas } = fetchFalso([new DOMException('The operation was aborted due to timeout', 'TimeoutError'), ok('{"intencao":"x"}')])
    const r = await cliente(f).completeJson(base)
    expect(r.ok).toBe(true)
    expect(chamadas).toHaveLength(2)
  })

  it('timeout de verdade: AbortSignal com o timeout da chamada', async () => {
    const { f, chamadas } = fetchFalso([ok('{"intencao":"x"}')])
    await cliente(f, { timeoutMs: 1234 }).completeJson(base)
    expect(chamadas[0]!.init.signal).toBeInstanceOf(AbortSignal)
  })

  it('todos esgotados por erro transitório ⇒ retryable true, com o status do último', async () => {
    const { f, chamadas } = fetchFalso([json(429, { error: { message: 'Rate limit' } }), json(502, {})])
    const r = await cliente(f).completeJson(base)
    expect(r).toMatchObject({ ok: false, retryable: true, status: 502, error: 'HTTP 502', usage: null })
    expect(chamadas).toHaveLength(2)
  })

  it('todos esgotados por rede ⇒ retryable true, status null', async () => {
    const { f } = fetchFalso([new TypeError('fetch failed'), new TypeError('fetch failed')])
    expect(await cliente(f).completeJson(base)).toMatchObject({ ok: false, retryable: true, status: null })
  })

  it('400 de requisição inválida ⇒ para, sem tentar o próximo, não retryable', async () => {
    const { f, chamadas } = fetchFalso([
      json(400, { error: { message: "Invalid schema for response_format 'triagem'", type: 'invalid_request_error', code: 'invalid_json_schema' } }),
    ])
    const r = await cliente(f).completeJson(base)
    expect(r).toMatchObject({ ok: false, retryable: false, status: 400, error: "Invalid schema for response_format 'triagem'" })
    expect(chamadas).toHaveLength(1)
  })

  it('401 (chave inválida) ⇒ para', async () => {
    const { f, chamadas } = fetchFalso([json(401, { error: { message: 'Incorrect API key provided', code: 'invalid_api_key' } })])
    expect(await cliente(f).completeJson(base)).toMatchObject({ ok: false, retryable: false, status: 401 })
    expect(chamadas).toHaveLength(1)
  })

  it('recusa do modelo (inexistente/sem acesso) ⇒ tenta o próximo', async () => {
    const { f, chamadas } = fetchFalso([
      json(404, { error: { message: 'The model `gpt-4.1-mini` does not exist or you do not have access to it.', code: 'model_not_found' } }),
      ok('{"intencao":"x"}'),
    ])
    expect((await cliente(f).completeJson(base)).ok).toBe(true)
    expect(chamadas).toHaveLength(2)
  })

  it('recusa de parâmetro pelo modelo ⇒ tenta o próximo', async () => {
    const { f, chamadas } = fetchFalso([
      json(400, { error: { message: "Unsupported value: 'reasoning_effort' does not support 'minimal' with this model.", code: 'unsupported_value', param: 'reasoning_effort' } }),
      ok('{"intencao":"x"}'),
    ])
    expect((await cliente(f).completeJson({ ...base, models: ['gpt-5-mini', 'gpt-4.1-mini'] })).ok).toBe(true)
    expect(chamadas).toHaveLength(2)
  })

  it('erro de PDF/imagem grande demais (400) ⇒ para', async () => {
    const { f, chamadas } = fetchFalso([json(400, { error: { message: 'File too large', type: 'invalid_request_error', code: null } })])
    const r = await cliente(f).completeJson({ ...base, userParts: [{ type: 'pdf', filename: 'a.pdf', base64: 'JVBE' }] })
    expect(r).toMatchObject({ ok: false, retryable: false, status: 400 })
    expect(chamadas).toHaveLength(1)
  })
})

describe('cliente da OpenAI: LGPD', () => {
  it('nada de conteúdo nem chave no console; mensagem de erro com PII mascarada e limitada', async () => {
    const espioes = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    const { f } = fetchFalso([json(400, { error: { message: `entrada inválida para maria@exemplo.com ${'x'.repeat(1000)}` } })])
    const r = await cliente(f).completeJson({ ...base, user: 'meu email é maria@exemplo.com', userParts: [{ type: 'pdf', filename: 'a.pdf', base64: 'SEGREDO' }] })
    if (r.ok) throw new Error('esperava falha')
    expect(r.error).not.toContain('maria@exemplo.com')
    expect(r.error.length).toBeLessThanOrEqual(400)
    for (const s of espioes) expect(s).not.toHaveBeenCalled()
  })
})

/** Strict do Structured Outputs: todo objeto com additionalProperties:false e todas as propriedades em required. */
function violacoesStrict(s: unknown, caminho = '$'): string[] {
  if (typeof s !== 'object' || s === null) return []
  const o = s as Record<string, unknown>
  const out: string[] = []
  if (o.properties && typeof o.properties === 'object') {
    const chaves = Object.keys(o.properties)
    const req = Array.isArray(o.required) ? (o.required as string[]) : []
    if (o.additionalProperties !== false) out.push(`${caminho}: additionalProperties != false`)
    for (const k of chaves) if (!req.includes(k)) out.push(`${caminho}.${k}: fora de required`)
    for (const [k, v] of Object.entries(o.properties)) out.push(...violacoesStrict(v, `${caminho}.${k}`))
  }
  if (o.items) out.push(...violacoesStrict(o.items, `${caminho}[]`))
  for (const k of ['anyOf', 'oneOf', 'allOf'] as const) {
    if (k === 'anyOf' && Array.isArray(o[k])) (o[k] as unknown[]).forEach((x, i) => out.push(...violacoesStrict(x, `${caminho}.anyOf[${i}]`)))
    else if (o[k] !== undefined) out.push(`${caminho}: ${k} não suportado no strict`)
  }
  return out
}

describe('esquemas atuais são compatíveis com strict da OpenAI', () => {
  it.each([
    ['triage-v1', triageJsonSchema],
    ['triage-v2', triageV2JsonSchema],
    ['triage-v3', triageV3JsonSchema],
    ['triage-v4', triageV4JsonSchema],
    ['triage-v5', triageV5JsonSchema],
    ['triage-v6', triageV6JsonSchema],
    ['ingestao-cardapio-v1', ingestaoJsonSchema],
  ])('%s', (_nome, s) => {
    expect(violacoesStrict(s)).toEqual([])
  })
})
