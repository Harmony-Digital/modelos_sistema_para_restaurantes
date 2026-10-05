import { describe, expect, it } from 'vitest'
import { dataBr, email, hora, senhaNova, telefoneBr } from './validation.ts'

describe('validação compartilhada', () => {
  it('e-mail com mensagem de correção', () => {
    const r = email.safeParse('maria@')
    expect(r.success).toBe(false)
    expect(r.error!.issues[0]!.message).toBe('Digite um e-mail completo, como nome@empresa.com.br')
  })
  it('senha nova exige 12 caracteres com letra e número', () => {
    expect(senhaNova.safeParse('curta1').success).toBe(false)
    expect(senhaNova.safeParse('somenteletrasaqui').success).toBe(false)
    expect(senhaNova.safeParse('Restaurante2026').success).toBe(true)
  })
  it.each([['11:30', true], ['23:59', true], ['24:00', false], ['9:00', false], ['11h30', false]])('hora %s', (v, ok) => {
    expect(hora.safeParse(v).success).toBe(ok)
  })
  it('data brasileira válida vira ISO; inválida explica', () => {
    expect(dataBr.parse('12/10/2026')).toBe('2026-10-12')
    const r = dataBr.safeParse('31/02/2026')
    expect(r.success).toBe(false)
    expect(r.error!.issues[0]!.message).toBe('Data inexistente. Use dd/mm/aaaa, como 12/10/2026')
  })
  it('telefone com DDD normaliza dígitos', () => {
    expect(telefoneBr.parse('(61) 99999-8888')).toBe('61999998888')
    expect(telefoneBr.safeParse('9999-8888').success).toBe(false)
  })
})
