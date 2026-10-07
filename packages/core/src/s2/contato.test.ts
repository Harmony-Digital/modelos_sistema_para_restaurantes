import { describe, expect, it } from 'vitest'
import { redactPii } from '../redact.ts'
import { capturarTelefone, mesmoTelefone } from './contato.ts'

describe('capturarTelefone', () => {
  it('normaliza as formas comuns de celular para E.164', () => {
    for (const texto of [
      '(61) 9 9999-8888', '+55 61 99999-8888', '61999998888', '61 99999 8888', '5561999998888',
      'pode ser o 61 99999-8888, por favor', '(61)99999-8888', '61.99999.8888', '(61) 99999.8888', '061.99999.8888',
    ]) {
      expect(capturarTelefone(texto), texto).toBe('+5561999998888')
    }
  })

  it('aceita o 0 de longa distância antes do DDD', () => {
    expect(capturarTelefone('061 99999-8888')).toBe('+5561999998888')
    expect(capturarTelefone('(061) 99999-8888')).toBe('+5561999998888')
  })

  it('aceita fixo com DDD', () => {
    expect(capturarTelefone('liga no (11) 3333-4444')).toBe('+551133334444')
  })

  it('o que a redação marca como telefone é o que a captura aceita (mesma validação)', () => {
    const texto = 'meu número é (61) 9 9999-8888'
    expect(redactPii(texto)).toBe('meu número é [TELEFONE]')
    expect(capturarTelefone(texto)).toBe('+5561999998888')
  })

  it('sem número válido ⇒ null', () => {
    for (const texto of [
      'não sei', '', 'sim', '99999-8888', // sem DDD
      '(00) 99999-8888', '(10) 99999-8888', // DDD inexistente
      '61 1999 8888', // fixo começando em 1
      '123', 'dia 12 às 20h', 'meu cpf é 529.982.247-25',
    ]) {
      expect(capturarTelefone(texto), texto).toBeNull()
    }
  })

  it('dois números diferentes ⇒ null (não escolhe)', () => {
    expect(capturarTelefone('61 99999-8888 ou 61 98888-7777')).toBeNull()
    expect(capturarTelefone('61 99999-8888, isso: (61) 9 9999-8888')).toBe('+5561999998888')
  })

  it('texto enorme não trava', () => {
    expect(capturarTelefone('9'.repeat(5000))).toBeNull()
  })
})

describe('mesmoTelefone', () => {
  it('o wa_id brasileiro antigo, sem o nono dígito, é o mesmo celular com o 9', () => {
    expect(mesmoTelefone('+5561999998888', '+556199998888')).toBe(true)
    expect(mesmoTelefone('+556199998888', '+5561999998888')).toBe(true)
    expect(mesmoTelefone('+5561999998888', '+5561999998888')).toBe(true)
  })
  it('números diferentes, fixo ou sem telefone não são o mesmo', () => {
    expect(mesmoTelefone('+5561999998888', '+5561999997777')).toBe(false)
    expect(mesmoTelefone('+5561999998888', '+556299998888')).toBe(false)
    // fixo (começa com 2–5) não ganha o 9
    expect(mesmoTelefone('+5561933334444', '+556133334444')).toBe(false)
    expect(mesmoTelefone('+5561999998888', null)).toBe(false)
  })
})
