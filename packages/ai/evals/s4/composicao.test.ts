import { describe, expect, it } from 'vitest'
import { resolverAtendimento, type ContextoS1 } from '@atd/core'
import { horasInventadasS2 } from '../s3/comparar.ts'
import { CASOS, FRASES, itensDoCaso, resumoDoCaso, type Caso } from './casos.ts'
import { CONTEXTO, CONTEXTO_PEQUENO, CONTEXTO_SEM_UNIDADES, CONTEXTO_UMA_UNIDADE, ESPACOS, precosForaDoBanco } from './fixture.ts'

const contextoDe = (c: Caso): ContextoS1 =>
  c.contexto === 'pequeno' ? CONTEXTO_PEQUENO : c.contexto === 'uma' ? CONTEXTO_UMA_UNIDADE : c.contexto === 'nenhuma' ? CONTEXTO_SEM_UNIDADES : CONTEXTO

function rodar(c: Caso) {
  const arquivos = new Set(c.arquivos ?? [])
  return resolverAtendimento(
    c.itens, contextoDe(c), new Date(c.agora), [], c.escolhida,
    { espacos: ESPACOS, pedidos: c.pedidos ?? [] },
    {
      achados: new Map(Object.entries(c.achados ?? {}).map(([k, v]) => [Number(k), v])),
      resumo: resumoDoCaso(c),
      temArquivo: (unitId) => arquivos.has(unitId) || arquivos.has(null),
    },
  )
}

describe('evals S4 — camada 2 (resolução + composição, determinística)', () => {
  it('gabarito tem pelo menos 50 casos e 30 frases (com mudança de evento e pendente), ids únicos', () => {
    expect(CASOS.length).toBeGreaterThanOrEqual(50)
    expect(FRASES.length).toBeGreaterThanOrEqual(30)
    expect(FRASES.filter((x) => x.itens.some((i) => i.servico === 'evento' && i.tema === 'mudanca')).length).toBeGreaterThanOrEqual(3)
    expect(FRASES.filter((x) => x.pendente).length).toBeGreaterThanOrEqual(2)
    expect(new Set(CASOS.map((c) => c.id)).size).toBe(CASOS.length)
    expect(new Set(FRASES.map((c) => c.id)).size).toBe(FRASES.length)
  })

  for (const caso of CASOS) {
    it(`${caso.id}: ${caso.mensagem}`, () => {
      const r = rodar(caso)
      const e = caso.espera
      if (e.texto !== undefined) expect(r.texto).toBe(e.texto)
      for (const t of e.contem ?? []) expect(r.texto).toContain(t)
      for (const t of e.naoContem ?? []) expect(r.texto ?? '').not.toContain(t)
      expect(r.acoesS4).toEqual(e.acoes ?? [])
      if (e.acoesS3) expect(r.acoesS3).toEqual(e.acoesS3)
      expect(r.lista !== null).toBe(e.lista ?? false)
      expect(r.handoff).toBe(e.handoff ?? false)
      if (e.lacunas) expect(r.lacunas.map((l) => l.chave)).toEqual(e.lacunas)
      if (e.indicador) expect([r.validos, r.respondidos]).toEqual(e.indicador)
      // meta: nenhum preço fora do banco e nenhum horário inexistente
      expect(precosForaDoBanco(r.texto, itensDoCaso(caso), resumoDoCaso(caso))).toEqual([])
      expect(horasInventadasS2(r.texto ?? '', contextoDe(caso), caso.itens)).toEqual([])
      expect(r).toMatchSnapshot()
    })
  }

  it('nenhum preço fora do banco: a asserção pega um preço inventado', () => {
    expect(precosForaDoBanco('Temos sim: **Picanha** — R$ 1,00', [], [])).toEqual(['R$ 1,00'])
    const c = CASOS.find((x) => x.id === 'b01')!
    expect(precosForaDoBanco(rodar(c).texto, itensDoCaso(c), resumoDoCaso(c))).toEqual([])
  })
})
