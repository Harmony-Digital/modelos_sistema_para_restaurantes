import { describe, expect, it } from 'vitest'
import { lerPessoas } from './pessoas.ts'

describe('lerPessoas', () => {
  it.each([
    ['4', 4],
    ['somos 5', 5],
    ['quatro', 4],
    ['Quatro pessoas', 4],
    ['eu e minha esposa', 2],
    ['Eu e meu marido', 2],
    ['só eu', 1],
    ['sozinho', 1],
    ['uma pessoa', 1],
    ['duas', 2],
    ['vinte', 20],
    ['dezesseis pessoas', 16],
    ['seremos 12', 12],
    ['pra 8 pessoas', 8],
    ['eu e mais 3', 4],
    ['eu e mais dois', 3],
    ['nós dois', 2],
    ['um casal', 2],
    ['60', 60],
    ['1', 1],
    ['uns 4', 4],
  ])('%s ⇒ %s', (texto, esperado) => {
    expect(lerPessoas(texto)).toBe(esperado)
  })

  it.each([
    'uns 4 ou 5',
    '4 ou 5',
    '4-5',
    'não sei',
    'talvez 3',
    'eu e meus filhos',
    '0',
    '61',
    '100',
    '',
    'oi',
    'vou sim',
    '4 adultos e 2 crianças',
  ])('ambíguo ou inválido: %s ⇒ null', (texto) => {
    expect(lerPessoas(texto)).toBeNull()
  })
})
