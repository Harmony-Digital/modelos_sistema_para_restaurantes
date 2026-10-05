import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { getTestDb, resetDb, seedRestaurant, seedStaff } from './test-utils.ts'
import type { JwtClaims } from './rls.ts'
import {
  carregarUnidadesPainel, removerExcecao, salvarExcecao, salvarHorarios, salvarRestaurante, salvarUnidade, type DadosUnidade,
} from './painel-unidades.ts'
import { auditLog, restaurants, staff, unitHourExceptions, unitHours, units } from './schema/index.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const as = (sub: string, aal: 'aal1' | 'aal2' = 'aal2'): JwtClaims => ({ sub, role: 'authenticated', aal })
const AGORA = new Date('2026-10-05T14:00:00-03:00')
const dados = (nome: string): DadosUnidade => ({
  nome, endereco: 'SHIS QI 11 Bloco A', bairro: 'Lago Sul', cidade: 'Brasília', uf: 'DF', cep: '71625205', telefone: '6133334444',
  apelidos: ['lago'], mapsUrl: null, lat: -15.84, lng: -47.87, ativo: true,
})
const semana = () => {
  const s = [[], [], [], [], [], [], []] as { abre: string; fecha: string }[][]
  s[6] = [{ abre: '18:00', fecha: '02:00' }]
  s[0] = [{ abre: '11:30', fecha: '16:00' }]
  return s
}

async function cenario() {
  const { restaurantId, unitId: u1 } = await seedRestaurant(db)
  const [u2] = await db.insert(units).values({ restaurantId, nome: 'Asa Norte', slug: 'asa-norte' }).returning()
  const dono = await seedStaff(db, sql, { restaurantId, papel: 'dono' })
  const gerenteU1 = await seedStaff(db, sql, { restaurantId, papel: 'gerente' })
  await db.update(staff).set({ unidadesPermitidas: [u1] }).where(eq(staff.userId, gerenteU1))
  const atendente = await seedStaff(db, sql, { restaurantId, papel: 'atendente' })
  return { restaurantId, u1, u2: u2!.id, dono, gerenteU1, atendente }
}
const acoes = (entidadeId: string) =>
  db.select({ acao: auditLog.acao }).from(auditLog).where(eq(auditLog.entidadeId, entidadeId)).orderBy(auditLog.id)

describe('painel — unidades', () => {
  it('dono cria, configura horários e exceção; tudo auditado', async () => {
    const c = await cenario()
    const r = await salvarUnidade(db, as(c.dono), c.restaurantId, null, dados('Lago Sul'))
    expect(r.ok).toBe(true)
    const id = r.ok ? r.valor.id : ''
    expect((await salvarHorarios(db, as(c.dono), c.restaurantId, id, semana())).ok).toBe(true)
    expect((await salvarExcecao(db, as(c.dono), c.restaurantId, id, { data: '2026-12-25', fechado: true, turnos: [], motivo: 'Natal' })).ok).toBe(true)

    const { unidades, restaurante } = await carregarUnidadesPainel(db, as(c.dono), AGORA)
    expect(restaurante).toMatchObject({ id: c.restaurantId, politicaFeriado: 'como_domingo' })
    const u = unidades.find((x) => x.id === id)!
    expect(u).toMatchObject({ nome: 'Lago Sul', slug: 'lago-sul', ativo: true, cep: '71625205', apelidos: ['lago'], lat: -15.84 })
    expect(u.semanal[6]).toEqual([{ abre: '18:00', fecha: '02:00' }])
    expect(u.excecoes['2026-12-25']).toEqual({ fechado: true, turnos: [], motivo: 'Natal' })
    expect((await acoes(id)).map((a) => a.acao)).toEqual(['unidade.criada', 'unidade.horarios', 'unidade.excecao_salva'])

    expect((await removerExcecao(db, as(c.dono), c.restaurantId, id, '2026-12-25')).ok).toBe(true)
    expect(await removerExcecao(db, as(c.dono), c.restaurantId, id, '2026-12-25')).toEqual({ ok: false, erro: 'nao_encontrada' })
  })

  it('repetir o envio não duplica', async () => {
    const c = await cenario()
    expect(await salvarUnidade(db, as(c.dono), c.restaurantId, null, dados('Asa Norte'))).toEqual({ ok: false, erro: 'nome_duplicado' })
    await salvarHorarios(db, as(c.dono), c.restaurantId, c.u1, semana())
    await salvarHorarios(db, as(c.dono), c.restaurantId, c.u1, semana())
    expect(await db.select().from(unitHours).where(eq(unitHours.unitId, c.u1))).toHaveLength(2)
    await salvarExcecao(db, as(c.dono), c.restaurantId, c.u1, { data: '2026-12-24', fechado: false, turnos: [{ abre: '11:00', fecha: '18:00' }], motivo: 'Véspera' })
    await salvarExcecao(db, as(c.dono), c.restaurantId, c.u1, { data: '2026-12-24', fechado: true, turnos: [{ abre: '11:00', fecha: '18:00' }], motivo: 'Fechado' })
    const exs = await db.select().from(unitHourExceptions).where(eq(unitHourExceptions.unitId, c.u1))
    expect(exs).toHaveLength(1)
    expect(exs[0]).toMatchObject({ fechado: true, turnos: [], motivo: 'Fechado' }) // fechado ⇒ sem turnos
  })

  it('falha no meio desfaz tudo, inclusive a auditoria', async () => {
    const c = await cenario()
    await salvarHorarios(db, as(c.dono), c.restaurantId, c.u1, semana())
    const ruim = semana()
    ruim[2] = [{ abre: '11:00', fecha: '11:00' }]
    await expect(salvarHorarios(db, as(c.dono), c.restaurantId, c.u1, ruim)).rejects.toMatchObject({ cause: { code: '23514' } })
    expect(await db.select().from(unitHours).where(eq(unitHours.unitId, c.u1))).toHaveLength(2)
    expect(await db.select().from(auditLog).where(and(eq(auditLog.entidadeId, c.u1), eq(auditLog.acao, 'unidade.horarios')))).toHaveLength(1)
  })

  it('gerente restrito: vê só a sua; a outra é "não encontrada"; não cria unidade nova', async () => {
    const c = await cenario()
    const { unidades } = await carregarUnidadesPainel(db, as(c.gerenteU1), AGORA)
    expect(unidades.map((u) => u.id)).toEqual([c.u1])
    expect(await salvarHorarios(db, as(c.gerenteU1), c.restaurantId, c.u2, semana())).toEqual({ ok: false, erro: 'nao_encontrada' })
    expect(await salvarUnidade(db, as(c.gerenteU1), c.restaurantId, c.u2, dados('Asa Norte'))).toEqual({ ok: false, erro: 'nao_encontrada' })
    expect(await salvarUnidade(db, as(c.gerenteU1), c.restaurantId, null, dados('Nova'))).toEqual({ ok: false, erro: 'sem_permissao' })
    expect((await salvarHorarios(db, as(c.gerenteU1), c.restaurantId, c.u1, semana())).ok).toBe(true)
  })

  it('atendente não altera nada; só o dono altera o restaurante', async () => {
    const c = await cenario()
    expect(await salvarUnidade(db, as(c.atendente, 'aal1'), c.restaurantId, null, dados('X'))).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(await salvarHorarios(db, as(c.atendente, 'aal1'), c.restaurantId, c.u1, [[], [], [], [], [], [], []])).toEqual({ ok: false, erro: 'sem_permissao' })
    const novo = { nome: 'Casa Harmonia', politicaFeriado: 'fechado' as const, politicaUrl: 'https://casa.test/privacidade' }
    expect(await salvarRestaurante(db, as(c.gerenteU1), c.restaurantId, novo)).toEqual({ ok: false, erro: 'sem_permissao' })
    expect((await salvarRestaurante(db, as(c.dono), c.restaurantId, novo)).ok).toBe(true)
    const [r] = await db.select().from(restaurants).where(eq(restaurants.id, c.restaurantId))
    expect(r).toMatchObject(novo)
  })
})
