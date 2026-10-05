import { describe, expect, it } from 'vitest'
import { renderReply } from './replies.ts'

describe('renderReply', () => {
  it('substitui o nome do restaurante', () => {
    expect(renderReply('foraEscopo', { restaurante: 'Casa X' })).toContain('Casa X')
  })
  it('aviso de privacidade inclui link e como chamar atendente', () => {
    const txt = renderReply('avisoPrivacidade', { restaurante: 'Casa X', politicaUrl: 'https://x.com/privacidade' })
    expect(txt).toContain('https://x.com/privacidade')
    expect(txt).toContain('*atendente*')
    expect(txt).toMatch(/assistente virtual/)
  })
  it('sem politicaUrl não deixa placeholder', () => {
    expect(renderReply('avisoPrivacidade', { restaurante: 'Casa X', politicaUrl: null })).not.toContain('{')
  })
})
