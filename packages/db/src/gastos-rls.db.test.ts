import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql as dsql } from 'drizzle-orm'
import { getTestDb, resetDb, seedRestaurant, seedStaff } from './test-utils.ts'
import { withRole, withUserContext, type JwtClaims } from './rls.ts'
import { budgetAlerts, budgetLimits, restaurants, retentionSettings, staffInvites } from './schema/index.ts'
import { DEFAULT_RETENTION } from './bootstrap.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const as = (sub: string, aal: 'aal1' | 'aal2' = 'aal2'): JwtClaims => ({ sub, role: 'authenticated', aal })
const negado = { cause: { code: '42501' } }

async function cenario() {
  const a = await seedRestaurant(db)
  const b = await seedRestaurant(db)
  const dono = await seedStaff(db, sql, { restaurantId: a.restaurantId, papel: 'dono' })
  const gerente = await seedStaff(db, sql, { restaurantId: a.restaurantId, papel: 'gerente' })
  const atendente = await seedStaff(db, sql, { restaurantId: a.restaurantId, papel: 'atendente' })
  return { a, b, dono, gerente, atendente }
}

describe('RLS e grants da Etapa 08', () => {
  it('budget_alerts: dono/gerente (MFA) leem o próprio restaurante; atendente não; painel não grava; worker grava', async () => {
    const { a, b, dono, gerente, atendente } = await cenario()
    const alerta = { escopo: 'ia' as const, periodo: 'dia' as const, inicioPeriodo: '2026-10-06', nivel: 80 }
    await db.insert(budgetAlerts).values([{ ...alerta, restaurantId: a.restaurantId }, { ...alerta, restaurantId: b.restaurantId }])
    expect(await withUserContext(db, as(dono), (tx) => tx.select().from(budgetAlerts))).toHaveLength(1)
    expect(await withUserContext(db, as(gerente), (tx) => tx.select().from(budgetAlerts))).toHaveLength(1)
    expect(await withUserContext(db, as(gerente, 'aal1'), (tx) => tx.select().from(budgetAlerts))).toHaveLength(0)
    expect(await withUserContext(db, as(atendente, 'aal1'), (tx) => tx.select().from(budgetAlerts))).toHaveLength(0)
    await expect(withUserContext(db, as(dono), (tx) =>
      tx.insert(budgetAlerts).values({ ...alerta, nivel: 100, restaurantId: a.restaurantId }))).rejects.toMatchObject(negado)
    await expect(withUserContext(db, as(dono), (tx) => tx.delete(budgetAlerts))).rejects.toMatchObject(negado)
    await withRole(db, 'worker_app', (tx) => tx.insert(budgetAlerts).values({ ...alerta, nivel: 100, restaurantId: a.restaurantId }))
    await expect(withRole(db, 'worker_app', (tx) => tx.delete(budgetAlerts))).rejects.toMatchObject(negado)
    await expect(db.insert(budgetAlerts).values({ ...alerta, nivel: 90, restaurantId: a.restaurantId }))
      .rejects.toMatchObject({ cause: { constraint_name: 'budget_alerts_nivel_ck' } })
  })

  it('budget_limits: só o dono altera limite e alerta; não muda escopo nem apaga; gerente só lê; atendente não vê', async () => {
    const { a, dono, gerente, atendente } = await cenario()
    const [l] = await db.insert(budgetLimits).values({ restaurantId: a.restaurantId, escopo: 'simulacao', periodo: 'dia', limiteUsd: '1' }).returning()
    const upd = (quem: string, v: Partial<typeof budgetLimits.$inferInsert>, aal: 'aal1' | 'aal2' = 'aal2') => withUserContext(db, as(quem, aal), (tx) =>
      tx.update(budgetLimits).set(v).where(eq(budgetLimits.id, l!.id)).returning({ id: budgetLimits.id }))
    expect(await upd(dono, { limiteUsd: '3', alertaPct: 70 })).toHaveLength(1)
    expect(await upd(gerente, { limiteUsd: '9' })).toHaveLength(0)
    expect(await upd(atendente, { limiteUsd: '9' }, 'aal1')).toHaveLength(0)
    await expect(upd(dono, { escopo: 'ia' })).rejects.toMatchObject(negado)
    await expect(upd(dono, { restaurantId: a.restaurantId })).rejects.toMatchObject(negado)
    await expect(withUserContext(db, as(dono), (tx) => tx.delete(budgetLimits))).rejects.toMatchObject(negado)
    expect(await withUserContext(db, as(gerente), (tx) => tx.select().from(budgetLimits))).toHaveLength(1)
    expect(await withUserContext(db, as(atendente, 'aal1'), (tx) => tx.select().from(budgetLimits))).toHaveLength(0)
    const [depois] = await db.select().from(budgetLimits)
    expect(depois).toMatchObject({ limiteUsd: '3.000000', alertaPct: 70 })
  })

  it('restaurants.cotacao_usd_brl: padrão 5,5; só o dono altera; check 0,5–50', async () => {
    const { a, dono, gerente } = await cenario()
    const [r] = await db.select().from(restaurants).where(eq(restaurants.id, a.restaurantId))
    expect(r!.cotacaoUsdBrl).toBe('5.5000')
    const upd = (quem: string, v: string) => withUserContext(db, as(quem), (tx) =>
      tx.update(restaurants).set({ cotacaoUsdBrl: v }).where(eq(restaurants.id, a.restaurantId)).returning({ id: restaurants.id }))
    expect(await upd(gerente, '6')).toHaveLength(0)
    expect(await upd(dono, '5.4321')).toHaveLength(1)
    await expect(upd(dono, '51')).rejects.toMatchObject({ cause: { constraint_name: 'restaurants_cotacao_ck' } })
  })

  it('retention_settings: só o dono altera dias, respeitando os mínimos; ninguém do painel insere ou apaga', async () => {
    const { a, dono, gerente } = await cenario()
    await db.insert(retentionSettings).values(DEFAULT_RETENTION.map((r) => ({ ...r, restaurantId: a.restaurantId })))
    const upd = (quem: string, dado: string, dias: number) => withUserContext(db, as(quem), (tx) =>
      tx.update(retentionSettings).set({ dias }).where(eq(retentionSettings.dado, dado)).returning({ dado: retentionSettings.dado }))
    expect(await upd(gerente, 'messages', 60)).toHaveLength(0)
    expect(await upd(dono, 'messages', 7)).toHaveLength(1)
    await expect(upd(dono, 'messages', 6)).rejects.toMatchObject({ cause: { constraint_name: 'retention_dias_minimo' } })
    await expect(upd(dono, 'ai_runs', 29)).rejects.toMatchObject({ cause: { constraint_name: 'retention_dias_minimo' } })
    await expect(withUserContext(db, as(dono), (tx) =>
      tx.update(retentionSettings).set({ acao: 'anonimizar' }).where(eq(retentionSettings.dado, 'messages')))).rejects.toMatchObject(negado)
    await expect(withUserContext(db, as(dono), (tx) => tx.delete(retentionSettings))).rejects.toMatchObject(negado)
    await expect(withUserContext(db, as(dono), (tx) =>
      tx.insert(retentionSettings).values({ restaurantId: a.restaurantId, dado: 'novo', dias: 60, acao: 'apagar' }))).rejects.toMatchObject(negado)
  })

  it('staff_invites: dono cria (sem papel dono); gerente lê e não cria; atendente não vê; worker lê e atualiza status', async () => {
    const { a, b, dono, gerente, atendente } = await cenario()
    const ins = (quem: string, papel: string, rid = a.restaurantId) => withUserContext(db, as(quem), (tx) => tx.execute<{ id: string }>(dsql`
      insert into public.staff_invites (restaurant_id, email, nome, papel, unidades, created_by)
      values (${rid}, ${`x${Math.random()}@teste.local`}, 'Novo', ${papel}::staff_role, '{}', ${quem}) returning id`))
    const [conv] = await ins(dono, 'atendente')
    await expect(ins(gerente, 'atendente')).rejects.toMatchObject(negado)
    await expect(ins(dono, 'atendente', b.restaurantId)).rejects.toMatchObject(negado)
    await expect(ins(dono, 'dono')).rejects.toMatchObject({ cause: { constraint_name: 'staff_invites_papel_ck' } })
    // created_by tem de ser o próprio usuário
    await expect(withUserContext(db, as(dono), (tx) => tx.execute(dsql`
      insert into public.staff_invites (restaurant_id, email, nome, papel, created_by)
      values (${a.restaurantId}, 'y@teste.local', 'Y', 'gerente', ${gerente})`))).rejects.toMatchObject(negado)
    expect(await withUserContext(db, as(gerente), (tx) => tx.select().from(staffInvites))).toHaveLength(1)
    expect(await withUserContext(db, as(atendente, 'aal1'), (tx) => tx.select().from(staffInvites))).toHaveLength(0)
    // painel só volta o status para pendente; não troca e-mail nem papel
    await expect(withUserContext(db, as(dono), (tx) =>
      tx.update(staffInvites).set({ email: 'z@teste.local' }).where(eq(staffInvites.id, conv!.id)))).rejects.toMatchObject(negado)
    await expect(withUserContext(db, as(dono), (tx) =>
      tx.update(staffInvites).set({ status: 'aceito' }).where(eq(staffInvites.id, conv!.id)))).rejects.toMatchObject(negado)
    await withRole(db, 'worker_app', (tx) => tx.update(staffInvites).set({ status: 'erro', erro: 'email_existente' }).where(eq(staffInvites.id, conv!.id)))
    await expect(withRole(db, 'worker_app', (tx) =>
      tx.update(staffInvites).set({ email: 'z@teste.local' }).where(eq(staffInvites.id, conv!.id)))).rejects.toMatchObject(negado)
    expect(await withUserContext(db, as(dono), (tx) =>
      tx.update(staffInvites).set({ status: 'pendente', erro: null }).where(eq(staffInvites.id, conv!.id)).returning({ id: staffInvites.id }))).toHaveLength(1)
    await expect(withUserContext(db, as(dono), (tx) => tx.delete(staffInvites))).rejects.toMatchObject(negado)
  })

  it('app.emails_da_equipe: e-mails do próprio restaurante só para dono/gerente com MFA', async () => {
    const { b, dono, gerente, atendente } = await cenario()
    await seedStaff(db, sql, { restaurantId: b.restaurantId, papel: 'dono' })
    const emails = (quem: string, aal: 'aal1' | 'aal2' = 'aal2') => withUserContext(db, as(quem, aal), (tx) =>
      tx.execute<{ user_id: string; email: string }>(dsql`select user_id, email from app.emails_da_equipe()`))
    expect(await emails(dono)).toHaveLength(3)
    expect(await emails(gerente)).toHaveLength(3)
    expect(await emails(gerente, 'aal1')).toHaveLength(0)
    expect(await emails(atendente, 'aal1')).toHaveLength(0)
  })

  it('funções novas: security definer, search_path vazio e EXECUTE só para quem precisa', async () => {
    const rows = await sql<{ f: string; def: boolean; cfg: string[] | null; pub: boolean; auth: boolean; web: boolean; worker: boolean }[]>`
      select p.proname as f, p.prosecdef as def, p.proconfig as cfg,
             has_function_privilege('public', p.oid, 'execute') as pub,
             has_function_privilege('authenticated', p.oid, 'execute') as auth,
             has_function_privilege('web_app', p.oid, 'execute') as web,
             has_function_privilege('worker_app', p.oid, 'execute') as worker
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and p.proname in ('excluir_titular', 'aplicar_retencao', 'apagar_cliente', 'resumo_titular', 'emails_da_equipe', 'custo_por_unidade')
       order by 1`
    const esperado = (auth: boolean, web: boolean, worker: boolean) => ({ def: true, cfg: ['search_path=""'], pub: false, auth, web, worker })
    expect(Object.fromEntries(rows.map(({ f, ...r }) => [f, r]))).toEqual({
      apagar_cliente: esperado(false, false, false),
      aplicar_retencao: esperado(false, false, true),
      custo_por_unidade: esperado(true, false, false),
      emails_da_equipe: esperado(true, false, false), // web_app é noinherit
      excluir_titular: esperado(false, true, false),
      resumo_titular: esperado(false, true, false),
    })
  })
})
