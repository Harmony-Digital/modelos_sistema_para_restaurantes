import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { getTestDb, resetDb, seedRestaurant, seedStaff } from './test-utils.ts'
import { withRole } from './rls.ts'
import { carregarContextoS1, registrarLacunas, taxaRespostaIa } from './s1.ts'
import { aiRuns, knowledgeFacts, knowledgeGaps, replyTemplates, unitHourExceptions, unitHours, units } from './schema/index.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const AGORA = new Date('2026-10-05T14:00:00-03:00')

describe('carregarContextoS1 (como worker_app)', () => {
  it('monta unidades ativas com agenda, fatos e modelos válidos', async () => {
    const { restaurantId, unitId } = await seedRestaurant(db)
    await db.update(units).set({ endereco: 'SCLS 404', lat: -15.8136, lng: -47.896, apelidos: ['204 sul'], ordem: 1 }).where(eq(units.id, unitId))
    const [inativa] = await db.insert(units).values({ restaurantId, nome: 'Fechada', slug: 'fechada', ativo: false }).returning()
    await db.insert(unitHours).values([
      { restaurantId, unitId, weekday: 2, turno: 2, abre: '18:00', fecha: '23:00' },
      { restaurantId, unitId, weekday: 2, turno: 1, abre: '11:30', fecha: '15:00' },
      { restaurantId, unitId: inativa!.id, weekday: 3, turno: 1, abre: '10:00', fecha: '12:00' },
    ])
    await db.insert(unitHourExceptions).values([
      { restaurantId, unitId, data: '2026-10-03', fechado: true },
      { restaurantId, unitId, data: '2026-10-04', fechado: true, motivo: 'Ontem' },
      { restaurantId, unitId, data: '2026-12-25', fechado: true, motivo: 'Natal' },
    ])
    await db.insert(knowledgeFacts).values([
      { restaurantId, tema: 'Estacionamento', texto: 'Temos estacionamento.' },
      { restaurantId, unitId: inativa!.id, tema: 'Wi-Fi', texto: 'Senha na mesa.' },
      { restaurantId, tema: 'Antigo', texto: 'Desativado.', ativo: false },
    ])
    await db.insert(replyTemplates).values([
      { restaurantId, chave: 'lacuna', texto: 'Vou confirmar com a equipe e já te digo.' },
      { restaurantId, chave: 'aberto_sim', texto: 'Aberta {xyz}' }, // inválido: ignorado
      { restaurantId, chave: 'inexistente', texto: 'x' },
    ])

    const ctx = await withRole(db, 'worker_app', (tx) => carregarContextoS1(tx, restaurantId, AGORA))
    expect(ctx).toMatchObject({ restaurante: 'Restaurante Teste', timezone: 'America/Sao_Paulo', politicaFeriado: 'como_domingo' })
    expect(ctx.unidades).toHaveLength(1)
    const u = ctx.unidades[0]!
    expect(u).toMatchObject({ id: unitId, nome: 'Asa Sul', apelidos: ['204 sul'], lat: -15.8136, lng: -47.896, endereco: 'SCLS 404' })
    expect(u.semanal[2]).toEqual([{ abre: '11:30', fecha: '15:00' }, { abre: '18:00', fecha: '23:00' }])
    expect(Object.keys(u.excecoes)).toEqual(['2026-10-04', '2026-12-25'])
    expect(u.semanal[3]).toEqual([])
    expect(ctx.fatos.map((f) => f.tema)).toEqual(['Estacionamento'])
    expect(ctx.modelos).toEqual({ lacuna: 'Vou confirmar com a equipe e já te digo.' })
  })
})

describe('carregarContextoS1 sem unidades ativas', () => {
  it('devolve unidades vazias e só os fatos gerais', async () => {
    const { restaurantId, unitId } = await seedRestaurant(db)
    await db.update(units).set({ ativo: false }).where(eq(units.id, unitId))
    await db.insert(unitHours).values({ restaurantId, unitId, weekday: 1, turno: 1, abre: '10:00', fecha: '12:00' })
    await db.insert(knowledgeFacts).values([
      { restaurantId, tema: 'Geral', texto: 'Fato geral.' },
      { restaurantId, unitId, tema: 'Da unidade', texto: 'Fato da unidade inativa.' },
    ])
    const ctx = await withRole(db, 'worker_app', (tx) => carregarContextoS1(tx, restaurantId, AGORA))
    expect(ctx.unidades).toEqual([])
    expect(ctx.fatos.map((f) => f.tema)).toEqual(['Geral'])
  })
})

describe('registrarLacunas (como worker_app)', () => {
  it('soma ocorrências na lacuna aberta, separa por unidade e trata unidade nula', async () => {
    const { restaurantId, unitId } = await seedRestaurant(db)
    const lacunas = [{ chave: 'info:wifi', unitId: null }, { chave: 'horario', unitId }]
    await withRole(db, 'worker_app', (tx) => registrarLacunas(tx, { restaurantId, lacunas, pergunta: 'tem wifi? [TELEFONE]' }))
    await withRole(db, 'worker_app', (tx) => registrarLacunas(tx, { restaurantId, lacunas, pergunta: 'e o wifi?' }))
    const rows = await db.select().from(knowledgeGaps).orderBy(knowledgeGaps.chaveNormalizada)
    expect(rows.map((r) => [r.chaveNormalizada, r.unitId, r.ocorrencias, r.perguntaMascarada])).toEqual([
      ['horario', unitId, 2, 'e o wifi?'],
      ['info:wifi', null, 2, 'e o wifi?'],
    ])
  })

  it('processa as lacunas em ordem estável, qualquer que seja a ordem de entrada', async () => {
    const { restaurantId, unitId } = await seedRestaurant(db)
    const a = { chave: 'a', unitId: null }
    const b = { chave: 'b', unitId }
    const c = { chave: 'b', unitId: null }
    const ordens: string[][] = []
    for (const lacunas of [[b, c, a], [a, c, b], [c, b, a]]) {
      await db.delete(knowledgeGaps)
      const vistas: string[] = []
      await withRole(db, 'worker_app', (tx) => {
        const espiao = new Proxy(tx, {
          get(alvo, prop, recv) {
            if (prop !== 'insert') return Reflect.get(alvo, prop, recv)
            return (...args: unknown[]) => {
              const ins = (alvo.insert as (...x: unknown[]) => { values: (v: { chaveNormalizada: string; unitId: string | null }) => unknown })(...args)
              const values = ins.values.bind(ins)
              ins.values = (v) => {
                vistas.push(`${v.chaveNormalizada}:${v.unitId ? 'u' : 'n'}`)
                return values(v)
              }
              return ins
            }
          },
        })
        return registrarLacunas(espiao, { restaurantId, lacunas, pergunta: 'p' })
      })
      ordens.push(vistas)
    }
    expect(ordens[0]).toEqual(['a:n', 'b:n', 'b:u'])
    expect(ordens[1]).toEqual(ordens[0])
    expect(ordens[2]).toEqual(ordens[0])
  })

  it('concorrência: duas transações ao mesmo tempo não duplicam', async () => {
    const { restaurantId } = await seedRestaurant(db)
    const lacunas = [{ chave: 'info:pet', unitId: null }]
    await Promise.all([1, 2, 3].map(() => withRole(db, 'worker_app', (tx) => registrarLacunas(tx, { restaurantId, lacunas, pergunta: 'pet?' }))))
    const rows = await db.select().from(knowledgeGaps)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.ocorrencias).toBe(3)
  })
})

describe('taxaRespostaIa', () => {
  it('soma hoje e 7 dias, sem simulação; atendente vê zero', async () => {
    const { restaurantId } = await seedRestaurant(db)
    const run = { restaurantId, etapa: 'triagem' as const, modelo: 'm', promptVersion: 'triage-v2' }
    await db.insert(aiRuns).values([
      { ...run, itensValidos: 2, itensRespondidos: 1, createdAt: new Date('2026-10-05T10:00:00-03:00') },
      { ...run, itensValidos: 3, itensRespondidos: 3, createdAt: new Date('2026-10-02T10:00:00-03:00') },
      { ...run, itensValidos: 1, itensRespondidos: 1, createdAt: new Date('2026-10-04T23:30:00-03:00') }, // ontem: fora de hoje
      { ...run, itensValidos: 5, itensRespondidos: 0, createdAt: new Date('2026-09-20T10:00:00-03:00') },
      { ...run, itensValidos: 4, itensRespondidos: 4, simulado: true, createdAt: new Date('2026-10-05T11:00:00-03:00') },
    ])
    const dono = await seedStaff(db, sql, { restaurantId, papel: 'dono' })
    const atendente = await seedStaff(db, sql, { restaurantId, papel: 'atendente' })
    expect(await taxaRespostaIa(db, { sub: dono, role: 'authenticated', aal: 'aal2' }, AGORA)).toEqual({
      hoje: { validos: 2, respondidos: 1 },
      seteDias: { validos: 6, respondidos: 5 },
    })
    expect(await taxaRespostaIa(db, { sub: atendente, role: 'authenticated', aal: 'aal1' }, AGORA)).toEqual({
      hoje: { validos: 0, respondidos: 0 },
      seteDias: { validos: 0, respondidos: 0 },
    })
  })
})
