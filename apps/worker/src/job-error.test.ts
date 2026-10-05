import { describe, expect, it } from 'vitest'
import { sanitizeJobError } from './job-error.ts'

describe('sanitizeJobError', () => {
  it('remove params do drizzle e não carrega stack/causa originais', () => {
    const cause = new Error('invalid input syntax: "Maria Sigilosa"')
    const err = new Error(
      'Failed query: insert into "messages" ("texto") values ($1)\nparams: Maria Sigilosa,Meu CPF é 529.982.247-25',
      { cause },
    )
    const out = sanitizeJobError(err)
    expect(out.message).toBe('Failed query: insert into "messages" ("texto") values ($1)\nparams: [redigido]')
    expect(out.cause).toBeUndefined()
    expect(JSON.stringify({ message: out.message, stack: out.stack })).not.toContain('Maria')
    expect(out.stack).not.toContain('529.982.247-25')
  })

  it('mascara PII na mensagem e limita a 500 caracteres', () => {
    const out = sanitizeJobError(new Error(`falha ao enviar para 61 99999-8888 ${'x'.repeat(1000)}`))
    expect(out.message).toContain('[TELEFONE]')
    expect(out.message).not.toContain('99999-8888')
    expect(out.message.length).toBe(500)
  })

  it('aceita valores que não são Error', () => {
    expect(sanitizeJobError('cpf 529.982.247-25').message).toBe('cpf [CPF]')
    expect(sanitizeJobError(undefined).message).toBe('undefined')
  })
})
