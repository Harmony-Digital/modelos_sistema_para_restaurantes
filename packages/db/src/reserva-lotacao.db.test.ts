import { readFileSync } from 'node:fs'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { createDb } from './client.ts'
import { comBanco, baseTestUrl, getTestDb, resetDb, seedRestaurant, testDbName } from './test-utils.ts'
import { withRole } from './rls.ts'
import { ocupacaoDoDia, registrarReserva, type GravarReserva } from './avisos.ts'
import { attendanceNotices, customers, units } from './schema/index.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const DIA = '2026-10-10'

async function cliente(restaurantId: string, hash: string, simulado = false) {
  const [c] = await db.insert(customers).values({ restaurantId, waIdHash: hash, telefoneCifrado: 'x', simulado }).returning({ id: customers.id })
  return c!.id
}
async function cenario(capacidade: number | null) {
  const { restaurantId, unitId } = await seedRestaurant(db)
  await db.update(units).set({ capacidadePessoas: capacidade }).where(eq(units.id, unitId))
  return { restaurantId, unitId }
}
const reserva = (restaurantId: string, unitId: string, customerId: string, o: Partial<GravarReserva> = {}): GravarReserva => ({
  restaurantId, unitId, customerId, data: DIA, pessoas: 4, horario: '20:00', nome: 'Ana', contatoCifrado: null,
  simulado: false, origem: 'ia', ...o,
})
const registrar = (r: GravarReserva) => db.transaction((tx) => registrarReserva(tx, r))
const confirmadas = (unitId: string) =>
  db.select().from(attendanceNotices)
    .where(and(eq(attendanceNotices.unitId, unitId), eq(attendanceNotices.data, DIA), eq(attendanceNotices.status, 'confirmada')))

describe('registrarReserva: lotação', () => {
  it('cabe: grava confirmada com horário, nome e contato; o mesmo cliente/unidade/dia atualiza', async () => {
    const { restaurantId, unitId } = await cenario(10)
    const c = await cliente(restaurantId, 'h1')
    const a = await registrar(reserva(restaurantId, unitId, c, { contatoCifrado: 'cifrado-1' }))
    expect(a).toEqual({ ok: true, id: expect.any(String), atualizou: false })
    const [linha] = await confirmadas(unitId)
    expect(linha).toMatchObject({ pessoas: 4, horario: '20:00:00', nome: 'Ana', contatoCifrado: 'cifrado-1', origem: 'ia', status: 'confirmada' })
    const b = await registrar(reserva(restaurantId, unitId, c, { pessoas: 6, horario: '21:30', contatoCifrado: null }))
    expect(b).toEqual({ ok: true, id: a.ok ? a.id : '', atualizou: true })
    expect(await confirmadas(unitId)).toMatchObject([{ pessoas: 6, horario: '21:30:00', contatoCifrado: null }])
  })

  it('lotado: não grava e devolve as vagas que restam (zero quando cheio)', async () => {
    const { restaurantId, unitId } = await cenario(150)
    const c1 = await cliente(restaurantId, 'h1')
    const c2 = await cliente(restaurantId, 'h2')
    const c3 = await cliente(restaurantId, 'h3')
    expect((await registrar(reserva(restaurantId, unitId, c1, { pessoas: 60 }))).ok).toBe(true)
    expect((await registrar(reserva(restaurantId, unitId, c2, { pessoas: 60 }))).ok).toBe(true)
    // canceladas e "não veio" não ocupam
    await db.insert(attendanceNotices).values([
      { restaurantId, unitId, data: DIA, pessoas: 50, origem: 'painel', status: 'cancelada' },
      { restaurantId, unitId, data: DIA, pessoas: 50, origem: 'painel', status: 'nao_veio' },
      { restaurantId, unitId, data: '2026-10-11', pessoas: 50, origem: 'painel' },
    ])
    expect((await registrar(reserva(restaurantId, unitId, c3, { pessoas: 27 }))).ok).toBe(true) // 147/150
    const c4 = await cliente(restaurantId, 'h4')
    expect(await registrar(reserva(restaurantId, unitId, c4, { pessoas: 4 }))).toEqual({ ok: false, motivo: 'lotado', vagas: 3 })
    expect(await confirmadas(unitId)).toHaveLength(3)
    expect((await registrar(reserva(restaurantId, unitId, c4, { pessoas: 3 }))).ok).toBe(true) // 150/150
    const c5 = await cliente(restaurantId, 'h5')
    expect(await registrar(reserva(restaurantId, unitId, c5, { pessoas: 1 }))).toEqual({ ok: false, motivo: 'lotado', vagas: 0 })
  })

  it('sem capacidade: nunca lota', async () => {
    const { restaurantId, unitId } = await cenario(null)
    for (let i = 0; i < 4; i++) {
      expect((await registrar(reserva(restaurantId, unitId, await cliente(restaurantId, `h${i}`), { pessoas: 60 }))).ok).toBe(true)
    }
    expect(await confirmadas(unitId)).toHaveLength(4)
  })

  it('aumentar desconta a própria reserva; diminuir nunca bloqueia (nem acima da lotação)', async () => {
    const { restaurantId, unitId } = await cenario(10)
    const c1 = await cliente(restaurantId, 'h1')
    const c2 = await cliente(restaurantId, 'h2')
    const a = await registrar(reserva(restaurantId, unitId, c1, { pessoas: 4 }))
    await registrar(reserva(restaurantId, unitId, c2, { pessoas: 4 }))
    const id = a.ok ? a.id : ''
    // 8/10: a própria (4) não conta ⇒ cabe até 6
    expect(await registrar(reserva(restaurantId, unitId, c1, { pessoas: 6, reservaId: id }))).toEqual({ ok: true, id, atualizou: true })
    expect(await registrar(reserva(restaurantId, unitId, c1, { pessoas: 7, reservaId: id }))).toEqual({ ok: false, motivo: 'lotado', vagas: 6 })
    expect((await db.select().from(attendanceNotices).where(eq(attendanceNotices.id, id)))[0]!.pessoas).toBe(6)
    // a lotação caiu abaixo do ocupado: diminuir passa mesmo assim
    await db.update(units).set({ capacidadePessoas: 5 }).where(eq(units.id, unitId))
    expect(await registrar(reserva(restaurantId, unitId, c1, { pessoas: 5, reservaId: id }))).toEqual({ ok: true, id, atualizou: true })
    // mesmo número também passa (só horário muda)
    expect(await registrar(reserva(restaurantId, unitId, c1, { pessoas: 5, horario: '19:00' }))).toEqual({ ok: true, id, atualizou: true })
  })

  it('simulado conta só entre simulados (e vice-versa)', async () => {
    const { restaurantId, unitId } = await cenario(10)
    const real = await cliente(restaurantId, 'h1')
    const sim = await cliente(restaurantId, 'h2', true)
    expect((await registrar(reserva(restaurantId, unitId, real, { pessoas: 10 }))).ok).toBe(true)
    expect((await registrar(reserva(restaurantId, unitId, sim, { pessoas: 10, simulado: true }))).ok).toBe(true)
    const sim2 = await cliente(restaurantId, 'h3', true)
    expect(await registrar(reserva(restaurantId, unitId, sim2, { pessoas: 1, simulado: true }))).toEqual({ ok: false, motivo: 'lotado', vagas: 0 })
    expect(await db.transaction((tx) => ocupacaoDoDia(tx, restaurantId, DIA, true))).toEqual(new Map([[unitId, { ocupadas: 10, capacidade: 10 }]]))
  })

  it('unidade de outro restaurante: recusa sem gravar', async () => {
    const a = await cenario(10)
    const b = await seedRestaurant(db)
    const c = await cliente(a.restaurantId, 'h1')
    await expect(registrar(reserva(a.restaurantId, b.unitId, c))).rejects.toThrow()
    expect(await db.select().from(attendanceNotices)).toHaveLength(0)
  })

  it('nome vazio é recusado (reserva nova exige nome)', async () => {
    const { restaurantId, unitId } = await cenario(10)
    const c = await cliente(restaurantId, 'h1')
    await expect(registrar(reserva(restaurantId, unitId, c, { nome: '  ' }))).rejects.toThrow('nome_obrigatorio')
  })

  it('concorrência: duas transações disputam as últimas vagas; só uma grava', async () => {
    const { restaurantId, unitId } = await cenario(10)
    await db.insert(attendanceNotices).values({ restaurantId, unitId, data: DIA, pessoas: 6, origem: 'painel' })
    const c1 = await cliente(restaurantId, 'h1')
    const c2 = await cliente(restaurantId, 'h2')
    // dois clientes de banco distintos (conexões separadas), como dois jobs do worker
    const url = comBanco(baseTestUrl(), testDbName())
    const x = createDb(url, { max: 1 })
    const y = createDb(url, { max: 1 })
    try {
      // determinístico: a 1ª grava e segura a transação aberta; só então a 2ª começa. Sem a trava da unidade, a 2ª
      // leria a ocupação sem a 1ª (não confirmada) e as duas gravariam.
      let gravou!: () => void
      const primeiraGravou = new Promise<void>((ok) => { gravou = ok })
      const rs = await Promise.all([
        x.db.transaction(async (tx) => {
          const r = await registrarReserva(tx, reserva(restaurantId, unitId, c1, { pessoas: 4 }))
          gravou()
          await new Promise((ok) => setTimeout(ok, 300))
          return r
        }),
        primeiraGravou.then(() => y.db.transaction((tx) => registrarReserva(tx, reserva(restaurantId, unitId, c2, { pessoas: 4 })))),
      ])
      expect(rs.filter((r) => r.ok)).toHaveLength(1)
      expect(rs.filter((r) => !r.ok)).toEqual([{ ok: false, motivo: 'lotado', vagas: 0 }])
      const total = (await confirmadas(unitId)).reduce((s, r) => s + r.pessoas, 0)
      expect(total).toBe(10)
    } finally {
      await x.sql.end()
      await y.sql.end()
    }
  })

  it('como worker_app (sem UPDATE em units): trava pela função e grava', async () => {
    const { restaurantId, unitId } = await cenario(5)
    const c = await cliente(restaurantId, 'h1')
    const r = await withRole(db, 'worker_app', (tx) => registrarReserva(tx, reserva(restaurantId, unitId, c, { pessoas: 5 })))
    expect(r.ok).toBe(true)
    const c2 = await cliente(restaurantId, 'h2')
    expect(await withRole(db, 'worker_app', (tx) => registrarReserva(tx, reserva(restaurantId, unitId, c2, { pessoas: 1 }))))
      .toEqual({ ok: false, motivo: 'lotado', vagas: 0 })
    expect(await withRole(db, 'worker_app', (tx) => ocupacaoDoDia(tx, restaurantId, DIA, false)))
      .toEqual(new Map([[unitId, { ocupadas: 5, capacidade: 5 }]]))
    // worker continua sem UPDATE em units
    await expect(withRole(db, 'worker_app', (tx) => tx.update(units).set({ capacidadePessoas: 50 })))
      .rejects.toMatchObject({ cause: { code: '42501' } })
  })
})

describe('ocupacaoDoDia', () => {
  it('soma só confirmadas do dia e do mesmo simulado, por unidade ativa do restaurante; sem reserva = 0', async () => {
    const { restaurantId, unitId } = await cenario(150)
    const [u2] = await db.insert(units).values({ restaurantId, nome: 'Norte', slug: 'norte' }).returning()
    await db.insert(units).values({ restaurantId, nome: 'Inativa', slug: 'inativa', ativo: false })
    const outro = await seedRestaurant(db)
    await db.insert(attendanceNotices).values([
      { restaurantId, unitId, data: DIA, pessoas: 7, origem: 'painel' },
      { restaurantId, unitId, data: DIA, pessoas: 3, origem: 'painel' },
      { restaurantId, unitId, data: DIA, pessoas: 9, origem: 'painel', status: 'cancelada' },
      { restaurantId, unitId, data: DIA, pessoas: 9, origem: 'painel', simulado: true },
      { restaurantId, unitId, data: '2026-10-11', pessoas: 9, origem: 'painel' },
      { restaurantId: outro.restaurantId, unitId: outro.unitId, data: DIA, pessoas: 9, origem: 'painel' },
    ])
    const m = await db.transaction((tx) => ocupacaoDoDia(tx, restaurantId, DIA, false))
    expect(m).toEqual(new Map([[unitId, { ocupadas: 10, capacidade: 150 }], [u2!.id, { ocupadas: 0, capacidade: null }]]))
  })

  it('EXPLAIN da soma por unidade e dia usa attendance_previsao_idx', async () => {
    const { restaurantId, unitId } = await cenario(150)
    const linhas = Array.from({ length: 2000 }, (_, i) => ({
      restaurantId, unitId, data: `2026-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`,
      pessoas: 2, origem: 'painel' as const,
    }))
    await db.insert(attendanceNotices).values(linhas)
    await sql`analyze public.attendance_notices`
    const plano = await sql.unsafe<{ 'QUERY PLAN': string }[]>(`
      explain select coalesce(sum(pessoas), 0) from public.attendance_notices
       where restaurant_id = '${restaurantId}' and unit_id = '${unitId}' and data = '${DIA}'
         and status = 'confirmada' and simulado = false and id <> '00000000-0000-4000-8000-000000000000'`)
    expect(plano.map((r) => r['QUERY PLAN']).join('\n')).toContain('attendance_previsao_idx')
  })
})

describe('migração do status (0045)', () => {
  it('o enum é confirmada | cancelada | nao_veio, o default é confirmada e o índice único vale para confirmada', async () => {
    const labels = await sql<{ l: string }[]>`
      select e.enumlabel as l from pg_enum e join pg_type t on t.oid = e.enumtypid
       where t.typname = 'attendance_status' order by e.enumsortorder`
    expect(labels.map((r) => r.l)).toEqual(['confirmada', 'cancelada', 'nao_veio'])
    const [idx] = await sql<{ def: string }[]>`select pg_get_indexdef('public.attendance_ativo_uq'::regclass) as def`
    expect(idx!.def).toContain(`'confirmada'`)
    const [col] = await sql<{ d: string }[]>`
      select column_default as d from information_schema.columns where table_name = 'attendance_notices' and column_name = 'status'`
    expect(col!.d).toContain('confirmada')
  })

  it('as instruções do enum da 0045 migram dados antigos: ativo → confirmada, cancelado → cancelada', async () => {
    const mig = readFileSync(new URL('../migrations/0045_reservas_logo.sql', import.meta.url), 'utf8')
    const doEnum = mig.split('--> statement-breakpoint')
      .map((s) => s.replace(/^--.*$/gm, '').trim())
      .filter((s) => s.startsWith('ALTER TYPE "public"."attendance_status"'))
    expect(doEnum).toHaveLength(3)
    const resultado = await sql.begin(async (tx) => {
      await tx.unsafe(`create schema atd_mig_teste`)
      await tx.unsafe(`create type atd_mig_teste.attendance_status as enum ('ativo', 'cancelado')`)
      await tx.unsafe(`create table atd_mig_teste.t (id int, status atd_mig_teste.attendance_status not null default 'ativo')`)
      await tx.unsafe(`create unique index t_uq on atd_mig_teste.t (id) where status = 'ativo'`)
      await tx.unsafe(`insert into atd_mig_teste.t values (1, 'ativo'), (2, 'cancelado'), (3, default)`)
      for (const s of doEnum) await tx.unsafe(s.replaceAll('"public"', '"atd_mig_teste"'))
      const rows = await tx.unsafe<{ id: number; status: string }[]>(`select id, status::text from atd_mig_teste.t order by id`)
      const [def] = await tx.unsafe<{ def: string }[]>(`select pg_get_indexdef('atd_mig_teste.t_uq'::regclass) as def`)
      await tx.unsafe(`drop schema atd_mig_teste cascade`)
      return { rows: [...rows], def: def!.def }
    })
    expect(resultado.rows).toEqual([{ id: 1, status: 'confirmada' }, { id: 2, status: 'cancelada' }, { id: 3, status: 'confirmada' }])
    expect(resultado.def).toContain(`'confirmada'`)
  })
})
