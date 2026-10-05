import { describe, expect, it } from 'vitest'
import { prefilter, type InboundItem } from './prefilter.ts'

const t = (texto: string): InboundItem => ({ tipo: 'texto', texto })

describe('prefilter', () => {
  it.each(['quero falar com atendente', 'ATENDENTE', 'tem algum humano aí?', 'quero falar com uma pessoa', 'atendimento humano por favor'])(
    'pedido de humano: %s',
    (msg) => expect(prefilter([t(msg)])).toEqual({ kind: 'handoff' }),
  )

  it('negação não dispara handoff', () => {
    expect(prefilter([t('não precisa de atendente, só quero o horário')]).kind).toBe('pass')
  })

  it.each([
    ['quero apagar meus dados', 'exclusao'],
    ['por favor excluam todos os meus dados', 'exclusao'],
    ['quais dados vocês têm sobre mim?', 'acesso'],
  ] as const)('pedido LGPD: %s', (msg, tipo) => {
    expect(prefilter([t(msg)])).toEqual({ kind: 'lgpd', tipo })
  })

  it.each(['oi', 'Olá!', 'bom dia 😊', 'boa noite, tudo bem?', 'e aí'])('saudação pura: %s', (msg) => {
    expect(prefilter([t(msg)])).toEqual({ kind: 'canned', reply: 'saudacao' })
  })

  it.each(['obrigado!', 'valeu', 'ok', '👍', 'perfeito, obrigada'])('agradecimento/encerramento: %s', (msg) => {
    expect(prefilter([t(msg)])).toEqual({ kind: 'canned', reply: 'agradecimento' })
  })

  it('saudação com pergunta passa adiante com o texto inteiro', () => {
    expect(prefilter([t('oi, vocês abrem domingo?')])).toEqual({ kind: 'pass', text: 'oi, vocês abrem domingo?' })
  })

  it('rajada é avaliada junta, em ordem', () => {
    expect(prefilter([t('oi'), t('queria saber'), t('abre domingo?')])).toEqual({
      kind: 'pass',
      text: 'oi\nqueria saber\nabre domingo?',
    })
  })

  it('mídia não suportada sem texto', () => {
    expect(prefilter([{ tipo: 'audio', texto: null }])).toEqual({ kind: 'unsupported_media' })
    expect(prefilter([{ tipo: 'outro', texto: null }, { tipo: 'imagem', texto: null }])).toEqual({ kind: 'unsupported_media' })
  })

  it('mídia com legenda/texto: usa só o texto', () => {
    expect(prefilter([{ tipo: 'imagem', texto: null }, t('isso tem no cardápio?')])).toEqual({
      kind: 'pass',
      text: 'isso tem no cardápio?',
    })
  })

  it('lista vazia ou só espaços vira agradecimento (nada a responder de útil)', () => {
    expect(prefilter([t('   ')])).toEqual({ kind: 'canned', reply: 'agradecimento' })
  })
})

describe('prefilter: refinamentos (rodada 1)', () => {
  it.each([
    'o atendente foi grosso',
    'o atendente me atendeu bem, obrigado',
    'tem atendente aos domingos?',
    'não consegui atendente',
    'pode remover a cebola dos dados?',
  ])('menção sem pedido segue adiante: %s', (msg) => {
    expect(prefilter([t(msg)]).kind).toBe('pass')
  })

  it.each([
    'atendente por favor',
    'humano',
    'falar com a gerente',
    'quero falar com o dono',
    'nao quero humano nenhum, quero atendente',
    'me passa um atendente',
  ])('pedido de pessoa: %s', (msg) => {
    expect(prefilter([t(msg)])).toEqual({ kind: 'handoff' })
  })

  it.each(['delete tudo que vocês sabem sobre mim', 'me exclua do cadastro', 'quero cancelar meus dados'])(
    'exclusão LGPD: %s',
    (msg) => {
      expect(prefilter([t(msg)])).toEqual({ kind: 'lgpd', tipo: 'exclusao' })
    },
  )
})
