import { describe, expect, it } from 'vitest'
import { scrubEvent } from './scrub.ts'

describe('scrubEvent', () => {
  it('remove corpo de requisição, usuário e campos sensíveis', () => {
    const ev = scrubEvent({
      request: { url: '/x', data: '{"texto":"oi"}' },
      user: { id: '1', ip_address: '1.2.3.4' },
      extra: { conversationId: 'c1', texto: 'oi', telefone: '556199' },
    })
    expect(ev.request).toEqual({ url: '/x' })
    expect(ev.user).toBeUndefined()
    expect(ev.extra).toEqual({ conversationId: 'c1' })
  })

  it('mascara PII em message e exception.values[].value', () => {
    const ev = scrubEvent({
      message: 'falha para joao@x.com',
      exception: { values: [{ value: 'insert failed params: 529.982.247-25' }, {}] },
    })
    expect(ev.message).toBe('falha para [EMAIL]')
    expect(ev.exception?.values?.[0]?.value).toBe('insert failed params: [CPF]')
    expect(ev.exception?.values?.[1]).toEqual({})
  })

  it('remove chaves sensíveis de contexts e de dados de breadcrumbs', () => {
    const ev = scrubEvent({
      contexts: { job: { id: 'j1', texto: 'oi', phone: '5561999998888' }, runtime: { name: 'node' } },
      breadcrumbs: [{ message: 'ligou 61 99999-8888', data: { url: '/x', body: 'segredo', waId: '55' } }, { message: 'ok' }],
    })
    expect(ev.contexts).toEqual({ job: { id: 'j1' }, runtime: { name: 'node' } })
    expect(ev.breadcrumbs).toEqual([{ message: 'ligou [TELEFONE]', data: { url: '/x' } }, { message: 'ok' }])
  })

  it('corta params de erros do drizzle (texto livre de clientes) e remove arguments de breadcrumbs', () => {
    const msg = 'Failed query: insert into messages values ($1,$2)\nparams: oi, moro na Rua X, sou a Maria Silva,hash\n    at foo (x.ts:1:1)'
    const ev = scrubEvent({
      message: msg,
      exception: { values: [{ value: msg }] },
      breadcrumbs: [{ message: msg, data: { arguments: ['Maria Silva'], url: '/x' } }],
    })
    const out = JSON.stringify(ev)
    expect(out).not.toMatch(/Maria Silva|Rua X/)
    expect(ev.message).toContain('params: [redigido]')
    expect(ev.message).toContain('at foo')
    expect(ev.breadcrumbs?.[0]?.data).toEqual({ url: '/x' })
  })
})
