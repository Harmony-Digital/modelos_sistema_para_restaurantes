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
    ['eu, meu marido e minha filha', 3],
    ['eu e meu irmão', 2],
    ['eu e ela', 2],
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
    'eu e a família',
    'eu e minha família',
    'eu e o pessoal',
    'eu e a galera',
    'eu e a turma',
    'dia 12',
    '2 da tarde',
    'amanhã às 8',
    'às 20',
    '20h',
    '8 hs',
    'sábado 4',
    'hoje 3',
    '10/10',
    '19:30',
    '',
    'oi',
    'vou sim',
    '4 adultos e 2 crianças',
  ])('ambíguo ou inválido: %s ⇒ null', (texto) => {
    expect(lerPessoas(texto)).toBeNull()
  })

  it.each(['61', '100', 'somos 80', 'eu e mais 70'])('número claro acima de 60: %s ⇒ fora', (texto) => {
    expect(lerPessoas(texto)).toBe('fora')
  })
})
