import { Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { createLogger } from './logger.ts'

function capture() {
  const lines: string[] = []
  const stream = new Writable({ write(chunk, _enc, cb) { lines.push(String(chunk)); cb() } })
  return { lines, stream }
}

describe('logger', () => {
  it('nunca escreve texto de mensagem nem telefone', () => {
    const { lines, stream } = capture()
    const log = createLogger('info', stream)
    log.info({ conversationId: 'c1', texto: 'meu cpf 52998224725', to: '5561999998888', payload: { body: 'segredo' } }, 'enviado')
    const out = lines.join('')
    expect(out).toContain('c1')
    expect(out).not.toMatch(/52998224725|5561999998888|segredo/)
  })

  it('serializer de err remove params/query e mascara PII na mensagem, detail e causa', () => {
    const { lines, stream } = capture()
    const log = createLogger('error', stream)
    const cause = Object.assign(new Error('duplicate key'), { detail: 'Key (email)=(joao@x.com) already exists' })
    const err = Object.assign(new Error('Failed query: insert into t values ($1)\nparams: 52998224725', { cause }), {
      params: ['52998224725'],
      query: 'insert into t values ($1)',
    })
    log.error({ err }, 'falhou')
    const out = lines.join('')
    expect(out).toContain('falhou')
    expect(out).toContain('[EMAIL]')
    expect(out).toContain('params: [redigido]')
    expect(out).not.toMatch(/52998224725|joao@x\.com|"params"|"query"/)
  })

  it('err do drizzle: params com texto livre não vaza em message, stack nem cause', () => {
    const { lines, stream } = capture()
    const log = createLogger('error', stream)
    const m = 'Failed query: insert into t values ($1)\nparams: oi, moro na Rua X, sou a Maria Silva,hash'
    const cause = new Error(m)
    log.error({ err: new Error(m, { cause }) }, 'falhou')
    const out = lines.join('')
    expect(out).toContain('params: [redigido]')
    expect(out).not.toMatch(/Maria Silva|Rua X/)
  })

  it.each([
    ['linha com "at" falso', 'Failed query: insert\nparams: oi\n  at home com Maria Silva\nfim,hash'],
    ['linha em branco e "at" falso', 'Failed query: insert\nparams: oi\n\n    at Rua X Maria Silva\nfim'],
  ])('adversarial (%s): nada vaza em message, stack nem cause', (_n, m) => {
    const { lines, stream } = capture()
    const log = createLogger('error', stream)
    log.error({ err: new Error(m, { cause: new Error(m) }) }, 'falhou')
    const out = lines.join('')
    expect(out).not.toMatch(/Maria Silva|Rua X|fim/)
    expect(out).toContain('params: [redigido]')
  })

  it('preserva frames reais da stack depois dos params', () => {
    const { lines, stream } = capture()
    createLogger('error', stream).error({ err: new Error('Failed query\nparams: Maria Silva') }, 'x')
    const err = (JSON.parse(lines.join('')) as { err: { stack: string } }).err
    expect(err.stack).toMatch(/params: \[redigido\]\n {4}at .*logger\.test\.ts:\d+:\d+/)
    expect(err.stack).not.toContain('Maria Silva')
  })
})
