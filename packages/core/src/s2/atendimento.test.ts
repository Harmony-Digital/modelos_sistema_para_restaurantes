import { describe, expect, it } from 'vitest'
import { CONTEXTO } from '../../../ai/evals/s1/fixture.ts'
import { resolverS1 } from '../s1/resolver.ts'
import type { ItemExtraido } from '../s1/tipos.ts'
import { resolverAtendimento } from './atendimento.ts'
import type { ContextoReserva } from './tipos.ts'

const SEG_14H = new Date('2026-10-05T14:00:00-03:00')
const base = { unidade: null, data: null, tema: null, pessoas: null, horario: null, convidados: null, tipoEvento: null, espaco: null, consulta: null, tag: null }
const h = (tipo: ItemExtraido['tipo'], extra: Partial<ItemExtraido> = {}): ItemExtraido =>
  ({ servico: 'horario_unidades', tipo, ...base, ...extra })
const reg = (extra: Partial<ItemExtraido> = {}): ItemExtraido => ({ servico: 'aviso_presenca', tipo: 'registrar', ...base, ...extra })

const AS_SABADO = 'Sábado (10/10), a unidade Asa Sul abre das 11h30 às 15h e das 18h às 2h.'

describe('resolverS1 ignora avisos de presença', () => {
  it('sem "em breve" e fora do indicador', () => {
    const r = resolverS1([reg({ unidade: 'asa sul', pessoas: 4 })], CONTEXTO, SEG_14H)
    expect(r.texto).toBeNull()
    expect([r.validos, r.respondidos]).toEqual([0, 0])
    expect(r.pendente).toEqual([])
  })
})

const REGRAS = 'Guardamos o lugar por 15 minutos.'
/** A mensagem responde à pergunta de contato: só assim o `contato_ok` do item vale. */
const RC: ContextoReserva = {
  vagas: new Map(), regras: REGRAS, pergunta: { campo: 'contato', item: reg(), unitId: null, tentativasNumero: 0 },
}
const res = (extra: Partial<ItemExtraido> = {}): ItemExtraido => reg({ horario: '20h', nome: 'Ana', contato_ok: true, ...extra })
const FEITA_AS_SAB = `Reserva feita: unidade Asa Sul, sábado (10/10), às 20h, 4 pessoas, em nome de Ana.\n\n${REGRAS}`
const atender = (itens: ItemExtraido[], escolhida?: string, ctx = CONTEXTO) =>
  resolverAtendimento(itens, ctx, SEG_14H, [], escolhida, undefined, undefined, RC)

describe('resolverAtendimento', () => {
  it('S1 + S2 na mesma mensagem: junta as respostas e soma o indicador', () => {
    const r = atender([h('horario_dia', { unidade: 'asa sul', data: 'sábado' }), res({ unidade: 'asa sul', data: 'sábado', pessoas: 4 })])
    expect(r.texto).toBe(`${AS_SABADO}\n\n${FEITA_AS_SAB}`)
    expect(r.acoesS2).toMatchObject([{ tipo: 'registrar', unitId: 'u-asa-sul', data: '2026-10-10', pessoas: 4, horario: '20:00', atualiza: false }])
    expect(r.perguntarReserva).toBeNull()
    expect(r.lista).toBeNull()
    expect([r.validos, r.respondidos]).toEqual([2, 2])
  })

  it('pendente de unidade une itens S1 e S2 numa só lista, na ordem da mensagem', () => {
    const itens = [res({ data: 'sábado', pessoas: 4 }), h('horario_dia', { data: 'sábado' })]
    const r = atender(itens)
    expect(r.pendente).toEqual(itens)
    expect(r.lista?.opcoes.map((o) => o.id)).toEqual(['u-asa-sul', 'u-asa-norte', 'u-lago-sul', 'u-aguas-claras'])
    expect(r.lista?.corpo).toBe('De qual unidade você quer saber? Toque em "Ver unidades" e escolha.')
    expect(r.texto).toBeNull()
    expect(r.acoesS2).toEqual([])
    // escolhida na lista: os dois itens são respondidos
    const depois = atender(r.pendente, 'u-asa-sul')
    expect(depois.texto).toBe(`${AS_SABADO}\n\n${FEITA_AS_SAB}`)
    expect(depois.acoesS2).toHaveLength(1)
    expect(depois.pendente).toEqual([])
  })

  it('só S2 pendente: mesmas opções do S1, com o texto que pergunta a unidade da reserva', () => {
    const r = atender([reg({ pessoas: 2 })])
    const s1 = resolverS1([h('horario_dia')], CONTEXTO, SEG_14H)
    expect(r.lista).toEqual({ ...s1.lista, corpo: 'Para qual unidade é a reserva? Toque em "Ver unidades" e escolha.' })
    expect(r.pendente).toHaveLength(1)
    // texto personalizado do restaurante
    const ctx = { ...CONTEXTO, modelos: { escolher_unidade_reserva: 'Em qual casa?' } }
    expect(atender([reg({ pessoas: 2 })], undefined, ctx).lista?.corpo).toBe('Em qual casa?')
  })

  it('pergunta pessoas por último, depois das respostas do S1', () => {
    const r = atender([reg({ unidade: 'asa sul', data: 'sábado' }), h('horario_dia', { unidade: 'asa sul', data: 'sábado' })])
    expect(r.texto).toBe(`${AS_SABADO}\n\nPara quantas pessoas?`)
    expect(r.perguntarReserva).toMatchObject({ campo: 'pessoas', item: { unidade: 'Asa Sul', data: '2026-10-10' }, unitId: 'u-asa-sul' })
    expect(r.acoesS2).toEqual([])
  })

  it('com lista de unidade pendente, não pergunta pessoas ao mesmo tempo (um dado por vez)', () => {
    const r = atender([reg({ unidade: 'asa sul', data: 'sábado' }), h('horario_dia')])
    expect(r.lista).not.toBeNull()
    expect(r.perguntarReserva).toBeNull()
    expect(r.texto).toBeNull()
  })
})
