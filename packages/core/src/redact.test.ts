import { describe, expect, it } from 'vitest'
import { redactPii } from './redact.ts'

describe('redactPii — mascara', () => {
  it.each([
    ['meu email é joao.silva+x@gmail.com', 'meu email é [EMAIL]'],
    ['cpf 529.982.247-25 por favor', 'cpf [CPF] por favor'],
    ['cpf 52998224725', 'cpf [CPF]'],
    ['cartão 4111 1111 1111 1111', 'cartão [CARTAO]'],
    ['me liga (61) 99999-8888', 'me liga [TELEFONE]'],
    ['whats +55 61 99999-8888', 'whats [TELEFONE]'],
    ['tel 61999998888', 'tel [TELEFONE]'],
    ['wa 5561999998888', 'wa [TELEFONE]'],
    ['wa +5561999998888', 'wa [TELEFONE]'],
    ['tel 61 9 9999-8888', 'tel [TELEFONE]'],
    ['tel 99999 8888', 'tel [TELEFONE]'],
    ['tel 99999-8888', 'tel [TELEFONE]'],
    ['cpf 529 982 247 25', 'cpf [CPF]'],
    ['rg 12.345.678-9', 'rg [RG]'],
    ['rg 12.345.678-X', 'rg [RG]'],
    ['5555 5555 5555 4444 ok', '[CARTAO] ok'],
    ['joão@exemplo.com.br', '[EMAIL]'],
    ['escreva para joão@exemplo.com.br já', 'escreva para [EMAIL] já'],
  ])('%s', (input, expected) => {
    expect(redactPii(input)).toBe(expected)
  })
})

describe('redactPii — preserva o que não é PII', () => {
  it.each([
    'hoje vou com 6 pessoas às 19:30',
    'o prato custa R$ 89,90?',
    'evento dia 12/10/2026 para 120 convidados',
    'mesa 12 na unidade 3',
    'CEP 70390-025',
    'pedido número 4111',
    'mesa para 12 pessoas às 20h',
    'R$ 1.234,56',
    'pedido 2026',
    '19:30 até 23:00',
  ])('%s', (input) => {
    expect(redactPii(input)).toBe(input)
  })
})
