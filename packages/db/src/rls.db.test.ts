import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql as dsql } from 'drizzle-orm'
import { getTestDb, resetDb, seedRestaurant, seedStaff } from './test-utils.ts'
import { withRole, withUserContext, type JwtClaims } from './rls.ts'
import { aiRuns, auditLog, budgetLimits, conversations, customers, dataSubjectRequests, messages, restaurants, units } from './schema/index.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const as = (sub: string, aal: 'aal1' | 'aal2'): JwtClaims => ({ sub, role: 'authenticated', aal })
const cause = (re: RegExp) => ({ cause: { message: expect.stringMatching(re) } })

describe('RLS', () => {
  it('toda tabela de public tem RLS habilitada', async () => {
    const rows = await sql<{ relname: string }[]>`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity`
    expect(rows.map((r) => r.relname)).toEqual([])
  })

  it('toda tabela de public tem mfa_required RESTRICTIVE (authenticated) e app_roles (web_app, worker_app)', async () => {
    const tables = await sql<{ t: string }[]>`
      select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r','p') order by 1`
    const policies = await sql<{ t: string; name: string; permissive: string; roles: string[]; cmd: string }[]>`
      select tablename as t, policyname as name, permissive, roles::text[] as roles, cmd
        from pg_policies where schemaname = 'public'`
    expect(tables.length).toBeGreaterThan(0)
    const missing: string[] = []
    for (const { t } of tables) {
      const mfa = policies.find((p) => p.t === t && p.name === 'mfa_required')
      if (!mfa || mfa.permissive !== 'RESTRICTIVE' || mfa.cmd !== 'ALL' || mfa.roles.join() !== 'authenticated') {
        missing.push(`${t}: mfa_required`)
      }
      const app = policies.find((p) => p.t === t && p.name === 'app_roles')
      if (!app || app.permissive !== 'PERMISSIVE' || [...app.roles].sort().join() !== 'web_app,worker_app') {
        missing.push(`${t}: app_roles`)
      }
    }
    expect(missing).toEqual([])
  })

  it('dono sem MFA (aal1) não vê nada; com aal2 vê o próprio restaurante', async () => {
    const { restaurantId } = await seedRestaurant(db)
    const dono = await seedStaff(db, sql, { restaurantId, papel: 'dono' })
    const semMfa = await withUserContext(db, as(dono, 'aal1'), (tx) => tx.select().from(restaurants))
    const comMfa = await withUserContext(db, as(dono, 'aal2'), (tx) => tx.select().from(restaurants))
    expect(semMfa).toHaveLength(0)
    expect(comMfa.map((r) => r.id)).toEqual([restaurantId])
  })

  it('atendente vê conversas do próprio restaurante e não de outro', async () => {
    const a = await seedRestaurant(db)
    const b = await seedRestaurant(db)
    const atendente = await seedStaff(db, sql, { restaurantId: a.restaurantId, papel: 'atendente' })
    for (const r of [a, b]) {
      const [c] = await db.insert(customers).values({ restaurantId: r.restaurantId, waIdHash: r.restaurantId, telefoneCifrado: 'x' }).returning()
      await db.insert(conversations).values({ restaurantId: r.restaurantId, customerId: c!.id })
    }
    const rows = await withUserContext(db, as(atendente, 'aal1'), (tx) => tx.select().from(conversations))
    expect(rows.map((r) => r.restaurantId)).toEqual([a.restaurantId])
  })

  it('atendente não lê limites de gasto; gerente não altera', async () => {
    const { restaurantId } = await seedRestaurant(db)
    await db.insert(budgetLimits).values({ restaurantId, escopo: 'ia', periodo: 'dia', limiteUsd: '5' })
    const atendente = await seedStaff(db, sql, { restaurantId, papel: 'atendente' })
    const gerente = await seedStaff(db, sql, { restaurantId, papel: 'gerente' })
    const lidos = await withUserContext(db, as(atendente, 'aal1'), (tx) => tx.select().from(budgetLimits))
    expect(lidos).toHaveLength(0)
    await expect(
      withUserContext(db, as(gerente, 'aal2'), (tx) =>
        tx.insert(budgetLimits).values({ restaurantId, escopo: 'ia', periodo: 'mes', limiteUsd: '50' }),
      ),
    ).rejects.toMatchObject(cause(/row-level security/))
  })

  it('audit_log é append-only até para o dono', async () => {
    const { restaurantId } = await seedRestaurant(db)
    const dono = await seedStaff(db, sql, { restaurantId, papel: 'dono' })
    await db.insert(auditLog).values({ restaurantId, atorTipo: 'sistema', acao: 'teste', entidade: 'x' })
    await expect(
      withUserContext(db, as(dono, 'aal2'), (tx) => tx.update(auditLog).set({ acao: 'adulterado' })),
    ).rejects.toMatchObject(cause(/permission denied/))
    await expect(withRole(db, 'worker_app', (tx) => tx.delete(auditLog))).rejects.toMatchObject(cause(/permission denied/))
  })

  it('worker_app grava mensagens mas não apaga', async () => {
    const { restaurantId } = await seedRestaurant(db)
    const [c] = await db.insert(customers).values({ restaurantId, waIdHash: 'h', telefoneCifrado: 'x' }).returning()
    const [conv] = await db.insert(conversations).values({ restaurantId, customerId: c!.id }).returning()
    await withRole(db, 'worker_app', (tx) =>
      tx.insert(messages).values({ restaurantId, conversationId: conv!.id, direcao: 'out', autor: 'ia', tipo: 'texto', texto: 'ok' }),
    )
    await expect(withRole(db, 'worker_app', (tx) => tx.delete(messages))).rejects.toMatchObject(cause(/permission denied/))
  })

  it('anon não acessa nada', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(dsql`set local role anon`)
        return tx.select().from(restaurants)
      }),
    ).rejects.toMatchObject(cause(/permission denied/))
  })

  it('authenticated não pode TRUNCATE (ignora RLS)', async () => {
    const { restaurantId } = await seedRestaurant(db)
    const dono = await seedStaff(db, sql, { restaurantId, papel: 'dono' })
    await expect(
      withUserContext(db, as(dono, 'aal2'), (tx) => tx.execute(dsql`truncate public.customers cascade`)),
    ).rejects.toMatchObject(cause(/permission denied/))
  })

  it('service_role não altera nem apaga audit_log', async () => {
    const { restaurantId } = await seedRestaurant(db)
    await db.insert(auditLog).values({ restaurantId, atorTipo: 'sistema', acao: 'teste', entidade: 'x' })
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(dsql`set local role service_role`)
        return tx.delete(auditLog)
      }),
    ).rejects.toMatchObject(cause(/permission denied/))
  })

  it('atendente não reaponta conversa para cliente de outro restaurante; muda estado', async () => {
    const a = await seedRestaurant(db)
    const b = await seedRestaurant(db)
    const atendente = await seedStaff(db, sql, { restaurantId: a.restaurantId, papel: 'atendente' })
    const [ca] = await db.insert(customers).values({ restaurantId: a.restaurantId, waIdHash: 'a', telefoneCifrado: 'x' }).returning()
    const [cb] = await db.insert(customers).values({ restaurantId: b.restaurantId, waIdHash: 'b', telefoneCifrado: 'x' }).returning()
    await db.insert(conversations).values({ restaurantId: a.restaurantId, customerId: ca!.id })
    await expect(
      withUserContext(db, as(atendente, 'aal1'), (tx) => tx.update(conversations).set({ customerId: cb!.id })),
    ).rejects.toMatchObject(cause(/permission denied/))
    const ok = await withUserContext(db, as(atendente, 'aal1'), (tx) =>
      tx.update(conversations).set({ estado: 'humano' }).returning(),
    )
    expect(ok).toHaveLength(1)
  })

  it('dono não cria unidade em outro restaurante', async () => {
    const a = await seedRestaurant(db)
    const b = await seedRestaurant(db)
    const dono = await seedStaff(db, sql, { restaurantId: a.restaurantId, papel: 'dono' })
    await expect(
      withUserContext(db, as(dono, 'aal2'), (tx) =>
        tx.insert(units).values({ restaurantId: b.restaurantId, nome: 'X', slug: 'x' }),
      ),
    ).rejects.toMatchObject(cause(/row-level security/))
  })

  it('worker_app insere ai_runs com RETURNING e atualiza o resultado', async () => {
    const { restaurantId } = await seedRestaurant(db)
    await withRole(db, 'worker_app', async (tx) => {
      const [run] = await tx.insert(aiRuns).values({ restaurantId, etapa: 'resposta', modelo: 'm', promptVersion: 'v1' }).returning({ id: aiRuns.id })
      const upd = await tx.update(aiRuns).set({ resultado: 'ok' }).where(dsql`${aiRuns.id} = ${run!.id}`).returning({ id: aiRuns.id })
      expect(upd).toHaveLength(1)
    })
  })

  it('auditoria de staff exige ator_tipo staff e o próprio ator_id', async () => {
    const { restaurantId } = await seedRestaurant(db)
    const atendente = await seedStaff(db, sql, { restaurantId, papel: 'atendente' })
    await expect(
      withUserContext(db, as(atendente, 'aal1'), (tx) =>
        tx.insert(auditLog).values({ restaurantId, atorId: atendente, atorTipo: 'sistema', acao: 'a', entidade: 'x' }),
      ),
    ).rejects.toMatchObject(cause(/row-level security/))
    await withUserContext(db, as(atendente, 'aal1'), (tx) =>
      tx.insert(auditLog).values({ restaurantId, atorId: atendente, atorTipo: 'staff', acao: 'a', entidade: 'x' }),
    )
  })

  it('gerente não apaga data_subject_requests', async () => {
    const { restaurantId } = await seedRestaurant(db)
    const gerente = await seedStaff(db, sql, { restaurantId, papel: 'gerente' })
    await db.insert(dataSubjectRequests).values({ restaurantId, tipo: 'acesso' })
    const del = await withUserContext(db, as(gerente, 'aal2'), (tx) => tx.delete(dataSubjectRequests).returning())
    expect(del).toHaveLength(0)
    expect(await db.select().from(dataSubjectRequests)).toHaveLength(1)
  })

  it('anon e authenticated não podem setval em sequences; worker_app ainda insere com identity', async () => {
    const { restaurantId } = await seedRestaurant(db)
    const dono = await seedStaff(db, sql, { restaurantId, papel: 'dono' })
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(dsql`set local role anon`)
        return tx.execute(dsql`select setval('public.messages_id_seq', 1, false)`)
      }),
    ).rejects.toMatchObject(cause(/permission denied/))
    await expect(
      withUserContext(db, as(dono, 'aal2'), (tx) => tx.execute(dsql`select setval('public.messages_id_seq', 1, false)`)),
    ).rejects.toMatchObject(cause(/permission denied/))
    const [c] = await db.insert(customers).values({ restaurantId, waIdHash: 'h', telefoneCifrado: 'x' }).returning()
    const [conv] = await db.insert(conversations).values({ restaurantId, customerId: c!.id }).returning()
    await withRole(db, 'worker_app', (tx) =>
      tx.insert(messages).values({ restaurantId, conversationId: conv!.id, direcao: 'out', autor: 'ia', tipo: 'texto', texto: 'ok' }),
    )
  })
})
