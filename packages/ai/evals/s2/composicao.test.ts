import { describe, expect, it } from 'vitest'
import { resolverAtendimento, type AcaoS2, type ContextoReserva } from '@atd/core'
import { CASOS, FRASES, REGRAS, type Caso } from './casos.ts'
import { horasInventadasS2 } from './comparar.ts'
import { CONTEXTO, CONTEXTO_PEQUENO } from './fixture.ts'

/** O que o worker passa: ocupação do caso, regras e a pergunta pendente (padrão: a de contato). */
function contextoReserva(caso: Caso): ContextoReserva {
  const vagas = new Map(Object.entries(caso.ocupacao ?? {}).map(([dia, us]) => [dia, new Map(Object.entries(us))]))
  const pergunta = caso.pendente !== undefined ? caso.pendente : {
    campo: 'contato' as const, item: { ...caso.itens[0]!, contato_ok: null }, unitId: null, tentativasNumero: 0,
  }
  return { vagas, regras: REGRAS, pergunta, ...(caso.numero ? { numero: caso.numero } : {}) }
}
/** O texto da corrida (lotado no commit) fica no snapshot; o caso confere o resto da ação. */
const semTextoDaCorrida = (acoes: readonly AcaoS2[]) =>
  acoes.map((a) => (a.tipo === 'registrar' ? Object.fromEntries(Object.entries(a).filter(([k]) => k !== 'textoSeLotado')) : a))

describe('evals S2 — camada 2 (resolução + composição, determinística)', () => {
  it('gabarito tem pelo menos 40 casos e 30 frases, ids únicos', () => {
    expect(CASOS.length).toBeGreaterThanOrEqual(40)
    expect(FRASES.length).toBeGreaterThanOrEqual(30)
    expect(new Set(CASOS.map((c) => c.id)).size).toBe(CASOS.length)
    expect(new Set(FRASES.map((c) => c.id)).size).toBe(FRASES.length)
  })

  for (const caso of CASOS) {
    it(`${caso.id}: ${caso.mensagem}`, () => {
      const ctx = caso.contexto === 'pequeno' ? CONTEXTO_PEQUENO : CONTEXTO
      const r = resolverAtendimento(caso.itens, ctx, new Date(caso.agora), caso.avisos ?? [], caso.escolhida, undefined, undefined, contextoReserva(caso))
      const e = caso.espera
      if (e.texto !== undefined) expect(r.texto).toBe(e.texto)
      for (const t of e.contem ?? []) expect(r.texto).toContain(t)
      for (const t of e.naoContem ?? []) expect(r.texto ?? '').not.toContain(t)
      expect(semTextoDaCorrida(r.acoesS2)).toEqual(e.acoes ?? [])
      expect(r.perguntarReserva !== null).toBe(e.pergunta ?? false)
      expect(r.lista !== null).toBe(e.lista ?? false)
      expect(horasInventadasS2(r.texto ?? '', ctx, caso.itens)).toEqual([]) // meta: 0 horário inexistente
      expect(r).toMatchSnapshot()
    })
  }
})
