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
})
