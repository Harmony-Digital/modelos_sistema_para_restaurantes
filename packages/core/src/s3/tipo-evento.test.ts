import { describe, expect, it } from 'vitest'
import { lerConvidados, normalizarTipoEvento, rotuloTipoEvento } from './tipo-evento.ts'

describe('normalizarTipoEvento', () => {
  it.each([
    ['aniversário', 'aniversario'],
    ['niver', 'aniversario'],
    ['Niver da minha filha', 'aniversario'],
    ['festa de 15 anos', 'aniversario'],
    ['debutante', 'aniversario'],
    ['casamento', 'casamento'],
    ['bodas de prata', 'casamento'],
    ['empresa', 'corporativo'],
    ['reunião da firma', 'corporativo'],
    ['evento corporativo', 'corporativo'],
    ['almoço com a equipe do trabalho', 'corporativo'],
    ['confraternização', 'confraternizacao'],
    ['confraternização da empresa', 'confraternizacao'],
    ['festa de fim de ano', 'confraternizacao'],
    ['encontro de amigos', 'confraternizacao'],
    ['chá de bebê', 'outro'],
    ['festa', 'outro'],
  ])('%s ⇒ %s', (texto, tipo) => {
    expect(normalizarTipoEvento(texto)).toEqual({ tipo, texto: texto.trim() })
  })

  it('vazio ⇒ null', () => {
    expect(normalizarTipoEvento(null)).toBeNull()
    expect(normalizarTipoEvento('')).toBeNull()
    expect(normalizarTipoEvento('   ')).toBeNull()
    expect(normalizarTipoEvento('!!')).toBeNull()
  })

  it('texto original curto (até 60 caracteres, sem espaços nas pontas)', () => {
    const longo = `  ${'formatura da turma de medicina '.repeat(4)}`
    const r = normalizarTipoEvento(longo)
    expect(r?.tipo).toBe('outro')
    expect(r?.texto.length).toBeLessThanOrEqual(60)
    expect(r?.texto).toBe(longo.trim().slice(0, 60).trim())
  })
})

describe('rotuloTipoEvento', () => {
  it('pt-BR; outro usa o texto do cliente', () => {
    expect(rotuloTipoEvento('aniversario', 'niver')).toBe('aniversário')
    expect(rotuloTipoEvento('casamento', 'bodas')).toBe('casamento')
    expect(rotuloTipoEvento('corporativo', 'empresa')).toBe('evento corporativo')
    expect(rotuloTipoEvento('confraternizacao', 'fim de ano')).toBe('confraternização')
    expect(rotuloTipoEvento('outro', 'chá de bebê')).toBe('chá de bebê')
    expect(rotuloTipoEvento('outro', '')).toBe('evento')
  })
})

describe('lerConvidados (parser de pessoas do S2 com limites do S3)', () => {
  it.each([['40', 40], ['uns 40', 40], ['somos 120', 120], ['1000', 1000], ['vinte', 20]])('%s ⇒ %s', (t, n) => {
    expect(lerConvidados(t)).toBe(n)
  })
  it('acima de 1000 ⇒ fora; ambíguo ⇒ null', () => {
    expect(lerConvidados('1001')).toBe('fora')
    expect(lerConvidados('uns 40 ou 50')).toBeNull()
    expect(lerConvidados('dia 20')).toBeNull()
  })
})
