import { describe, expect, it } from 'vitest'
import { resolverAtendimento } from '@atd/core'
import { CASOS, FRASES } from './casos.ts'
import { horasInventadasS2 } from './comparar.ts'
import { CONTEXTO, CONTEXTO_PEQUENO, CONTEXTO_SEM_UNIDADES, CONTEXTO_UMA_UNIDADE, ESPACOS } from './fixture.ts'

const contextoDe = (c: (typeof CASOS)[number]) =>
  c.contexto === 'pequeno' ? CONTEXTO_PEQUENO : c.contexto === 'uma' ? CONTEXTO_UMA_UNIDADE : c.contexto === 'nenhuma' ? CONTEXTO_SEM_UNIDADES : CONTEXTO
// único texto que pode conter "confirmado": o handoff de pedido confirmado pela equipe
const HANDOFF = 'Esse evento já foi confirmado pela equipe.'

describe('evals S3 — camada 2 (resolução + composição, determinística)', () => {
  it('gabarito tem pelo menos 50 casos e 30 frases (com pares pendente + resposta), ids únicos', () => {
    expect(CASOS.length).toBeGreaterThanOrEqual(50)
    expect(FRASES.length).toBeGreaterThanOrEqual(30)
    expect(FRASES.filter((x) => x.pendente).length).toBeGreaterThanOrEqual(8)
    expect(new Set(CASOS.map((c) => c.id)).size).toBe(CASOS.length)
    expect(new Set(FRASES.map((c) => c.id)).size).toBe(FRASES.length)
  })

  for (const caso of CASOS) {
    it(`${caso.id}: ${caso.mensagem}`, () => {
      const ctx = contextoDe(caso)
      const r = resolverAtendimento(
        caso.itens, ctx, new Date(caso.agora), caso.avisos ?? [], caso.escolhida,
        { espacos: caso.semEspacos ? [] : ESPACOS, pedidos: caso.pedidos ?? [] },
      )
      const e = caso.espera
      if (e.texto !== undefined) expect(r.texto).toBe(e.texto)
      for (const t of e.contem ?? []) expect(r.texto).toContain(t)
      for (const t of e.naoContem ?? []) expect(r.texto ?? '').not.toContain(t)
      expect(r.acoesS3).toEqual(e.acoes ?? [])
      expect(r.acoesS2).toEqual(e.acoesS2 ?? [])
      expect(r.perguntarEvento?.campo ?? null).toBe(e.pergunta ?? null)
      expect(r.lista !== null).toBe(e.lista ?? false)
      expect(r.handoff).toBe(e.handoff ?? false)
      expect(r.lacunas.map((l) => l.chave)).toEqual(e.lacunas ?? [])
      // a IA nunca promete a reserva: "confirmado"/"reservado" só no handoff de pedido já confirmado pela equipe
      expect((r.texto ?? '').replace(HANDOFF, '')).not.toMatch(/confirmad|reservad/i)
      expect(horasInventadasS2(r.texto ?? '', ctx, caso.itens)).toEqual([]) // meta: 0 horário inexistente
      expect(r).toMatchSnapshot()
    })
  }

  it('o handoff é o único caso com "confirmado"; os demais textos nunca prometem a reserva', () => {
    const comConfirmado = CASOS.filter((c) => {
      const r = resolverAtendimento(c.itens, contextoDe(c), new Date(c.agora), c.avisos ?? [], c.escolhida, { espacos: c.semEspacos ? [] : ESPACOS, pedidos: c.pedidos ?? [] })
      return /confirmad/i.test(r.texto ?? '')
    })
    expect(comConfirmado.length).toBeGreaterThan(0)
    for (const c of comConfirmado) expect(c.espera.handoff).toBe(true)
  })
})
