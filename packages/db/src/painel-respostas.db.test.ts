import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { getTestDb, resetDb, seedRestaurant, seedStaff } from './test-utils.ts'
import type { JwtClaims } from './rls.ts'
import {
  ignorarLacuna, listarFatos, listarLacunas, listarModelos, removerFato, responderLacuna, restaurarModelo, resumoInicio,
  salvarFato, salvarModelo,
} from './painel-respostas.ts'
import { auditLog, knowledgeFacts, knowledgeGaps, replyTemplates, staff, units } from './schema/index.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const as = (sub: string, aal: 'aal1' | 'aal2' = 'aal2'): JwtClaims => ({ sub, role: 'authenticated', aal })
const fato = (tema: string, unitId: string | null = null) => ({ tema, exemplos: ['tem?'], texto: `Sobre ${tema}: sim.`, unitId, ativo: true })

async function cenario() {
  const { restaurantId, unitId: u1 } = await seedRestaurant(db)
  const [u2] = await db.insert(units).values({ restaurantId, nome: 'Asa Norte', slug: 'asa-norte' }).returning()
  const dono = await seedStaff(db, sql, { restaurantId, papel: 'dono' })
  const gerenteU1 = await seedStaff(db, sql, { restaurantId, papel: 'gerente' })
  await db.update(staff).set({ unidadesPermitidas: [u1] }).where(eq(staff.userId, gerenteU1))
  const atendente = await seedStaff(db, sql, { restaurantId, papel: 'atendente' })
  const [gGeral, gU2, gU1] = await db.insert(knowledgeGaps).values([
    { restaurantId, chaveNormalizada: 'info:estacionamento', perguntaMascarada: 'tem estacionamento?', ocorrencias: 5 },
    { restaurantId, unitId: u2!.id, chaveNormalizada: 'info:wifi', perguntaMascarada: 'tem wifi?', ocorrencias: 3 },
    { restaurantId, unitId: u1, chaveNormalizada: 'horario', perguntaMascarada: 'abre que horas?', ocorrencias: 1 },
  ]).returning()
  return { restaurantId, u1, u2: u2!.id, dono, gerenteU1, atendente, gGeral: gGeral!.id, gU2: gU2!.id, gU1: gU1!.id }
}

describe('painel — lacunas', () => {
  it('responder cria o fato, fecha a lacuna e audita', async () => {
    const c = await cenario()
    const r = await responderLacuna(db, as(c.dono), c.restaurantId, c.gGeral, fato('Estacionamento'))
    expect(r.ok).toBe(true)
    const factId = r.ok ? r.valor.factId : ''
    const [g] = await db.select().from(knowledgeGaps).where(eq(knowledgeGaps.id, c.gGeral))
    expect(g).toMatchObject({ status: 'respondida', factId })
    const [f] = await db.select().from(knowledgeFacts).where(eq(knowledgeFacts.id, factId))
    expect(f).toMatchObject({ tema: 'Estacionamento', unitId: null, ativo: true })
    expect((await db.select().from(auditLog).where(eq(auditLog.entidadeId, c.gGeral))).map((a) => a.acao)).toEqual(['lacuna.respondida'])
    expect((await listarLacunas(db, as(c.dono))).map((l) => l.id)).toEqual([c.gU2, c.gU1])
    expect(await responderLacuna(db, as(c.dono), c.restaurantId, c.gGeral, fato('x'))).toEqual({ ok: false, erro: 'nao_encontrada' })
  })

  it('ignorar tira da fila; a lista vem com nome da unidade e mais frequentes primeiro', async () => {
    const c = await cenario()
    const lista = await listarLacunas(db, as(c.dono))
    expect(lista.map((l) => [l.chave, l.unidade, l.ocorrencias])).toEqual([
      ['info:estacionamento', null, 5], ['info:wifi', 'Asa Norte', 3], ['horario', 'Asa Sul', 1],
    ])
    expect((await ignorarLacuna(db, as(c.dono), c.restaurantId, c.gU1)).ok).toBe(true)
    expect(await ignorarLacuna(db, as(c.dono), c.restaurantId, c.gU1)).toEqual({ ok: false, erro: 'nao_encontrada' })
  })

  it('gerente restrito: não vê lacuna de outra unidade; lacuna geral exige acesso a todas', async () => {
    const c = await cenario()
    expect((await listarLacunas(db, as(c.gerenteU1))).map((l) => l.id)).toEqual([c.gGeral, c.gU1])
    expect(await responderLacuna(db, as(c.gerenteU1), c.restaurantId, c.gU2, fato('Wi-Fi', c.u2))).toEqual({ ok: false, erro: 'nao_encontrada' })
    expect(await responderLacuna(db, as(c.gerenteU1), c.restaurantId, c.gGeral, fato('Estacionamento'))).toEqual({ ok: false, erro: 'sem_permissao' })
    expect((await responderLacuna(db, as(c.gerenteU1), c.restaurantId, c.gU1, fato('Horário', c.u1))).ok).toBe(true)
  })
})

describe('painel — informações e modelos', () => {
  it('cria, edita e remove informação com auditoria; atendente só lê', async () => {
    const c = await cenario()
    const r = await salvarFato(db, as(c.dono), c.restaurantId, null, fato('Pet friendly'))
    const id = r.ok ? r.valor.id : ''
    expect((await salvarFato(db, as(c.dono), c.restaurantId, id, { ...fato('Pet friendly'), texto: 'Aceitamos pets.' })).ok).toBe(true)
    expect((await listarFatos(db, as(c.atendente, 'aal1'))).map((f) => [f.tema, f.texto])).toEqual([['Pet friendly', 'Aceitamos pets.']])
    expect(await salvarFato(db, as(c.atendente, 'aal1'), c.restaurantId, null, fato('X'))).toEqual({ ok: false, erro: 'sem_permissao' })
    expect((await removerFato(db, as(c.dono), c.restaurantId, id)).ok).toBe(true)
    expect(await removerFato(db, as(c.dono), c.restaurantId, id)).toEqual({ ok: false, erro: 'nao_encontrada' })
    expect((await db.select().from(auditLog).where(eq(auditLog.entidadeId, id))).map((a) => a.acao)).toEqual(['fato.criado', 'fato.atualizado', 'fato.removido'])
  })

  it('modelo personalizado: salva, atualiza e restaura o padrão', async () => {
    const c = await cenario()
    await salvarModelo(db, as(c.dono), c.restaurantId, 'lacuna', 'Vou confirmar com a equipe.')
    await salvarModelo(db, as(c.dono), c.restaurantId, 'lacuna', 'Vou confirmar e já te digo.')
    expect(await listarModelos(db, as(c.dono))).toEqual({ lacuna: 'Vou confirmar e já te digo.' })
    expect(await db.select().from(replyTemplates)).toHaveLength(1)
    expect((await restaurarModelo(db, as(c.dono), c.restaurantId, 'lacuna')).ok).toBe(true)
    expect(await listarModelos(db, as(c.dono))).toEqual({})
  })

  it('resumo do Início traz as 3 lacunas mais frequentes e a taxa', async () => {
    const c = await cenario()
    const r = await resumoInicio(db, as(c.dono), new Date('2026-10-05T14:00:00-03:00'))
    expect(r.lacunas.map((l) => l.chave)).toEqual(['info:estacionamento', 'info:wifi', 'horario'])
    expect(r.taxa).toEqual({ hoje: { validos: 0, respondidos: 0 }, seteDias: { validos: 0, respondidos: 0 } })
  })
})
