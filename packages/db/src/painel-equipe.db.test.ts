import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createAuthUser, getTestDb, resetDb, seedRestaurant, seedStaff } from './test-utils.ts'
import { withRole, type JwtClaims } from './rls.ts'
import {
  concluirConvite, conviteParaProcessar, criarConvite, definirAtivo, listarEquipe, reenviarConvite, restaurantesAtivos,
} from './painel-equipe.ts'
import { auditLog, staff, staffInvites, units } from './schema/index.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const as = (sub: string, aal: 'aal1' | 'aal2' = 'aal2'): JwtClaims => ({ sub, role: 'authenticated', aal })

async function cenario() {
  const { restaurantId, unitId } = await seedRestaurant(db)
  const [u2] = await db.insert(units).values({ restaurantId, nome: 'Norte', slug: 'norte' }).returning()
  const dono = await seedStaff(db, sql, { restaurantId, papel: 'dono' })
  const gerente = await seedStaff(db, sql, { restaurantId, papel: 'gerente' })
  const atendente = await seedStaff(db, sql, { restaurantId, papel: 'atendente' })
  return { restaurantId, unitId, u2: u2!.id, dono, gerente, atendente }
}
const convite = (o: Partial<Parameters<typeof criarConvite>[2]> = {}) =>
  ({ email: 'nova@teste.local', nome: 'Nova Pessoa', papel: 'atendente' as const, unidades: 'todas' as const, ...o })
const logs = () => db.select().from(auditLog).orderBy(auditLog.id)

describe('convites', () => {
  it('dono convida; auditoria sem e-mail nem nome; gerente e atendente não convidam', async () => {
    const c = await cenario()
    const r = await criarConvite(db, as(c.dono), convite({ email: ' Nova@Teste.Local ', unidades: [c.u2] }))
    expect(r.ok).toBe(true)
    const id = r.ok ? r.valor.conviteId : ''
    const [inv] = await db.select().from(staffInvites)
    expect(inv).toMatchObject({ id, email: 'nova@teste.local', nome: 'Nova Pessoa', papel: 'atendente', unidades: [c.u2], status: 'pendente', createdBy: c.dono })
    const [log] = await logs()
    expect(log).toMatchObject({ acao: 'equipe.convite_criado', entidade: 'staff_invite', entidadeId: id, diff: { papel: 'atendente', unidades: [c.u2] } })
    expect(JSON.stringify(log)).not.toMatch(/nova@|Nova Pessoa/i)
    expect(await criarConvite(db, as(c.gerente), convite({ email: 'x@teste.local' }))).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(await criarConvite(db, as(c.atendente, 'aal1'), convite({ email: 'x@teste.local' }))).toEqual({ ok: false, erro: 'sem_permissao' })
  })

  it('ja_existe: convite em aberto (sem diferenciar maiúsculas) ou e-mail de quem já é da equipe', async () => {
    const c = await cenario()
    expect((await criarConvite(db, as(c.dono), convite())).ok).toBe(true)
    expect(await criarConvite(db, as(c.dono), convite({ email: 'NOVA@teste.local' }))).toEqual({ ok: false, erro: 'ja_existe' })
    const [u] = await sql<{ email: string }[]>`select email from auth.users where id = ${c.gerente}`
    const email = u!.email
    expect(await criarConvite(db, as(c.dono), convite({ email: email.toUpperCase() }))).toEqual({ ok: false, erro: 'ja_existe' })
  })

  it('valida papel, e-mail, nome e unidades (de outro restaurante ⇒ nao_encontrada; todas ⇒ lista vazia)', async () => {
    const c = await cenario()
    const b = await seedRestaurant(db)
    expect(await criarConvite(db, as(c.dono), convite({ papel: 'dono' as never }))).toEqual({ ok: false, erro: 'valor_invalido' })
    expect(await criarConvite(db, as(c.dono), convite({ email: 'sem-arroba' }))).toEqual({ ok: false, erro: 'valor_invalido' })
    expect(await criarConvite(db, as(c.dono), convite({ nome: ' ' }))).toEqual({ ok: false, erro: 'valor_invalido' })
    expect(await criarConvite(db, as(c.dono), convite({ unidades: [] }))).toEqual({ ok: false, erro: 'valor_invalido' })
    expect(await criarConvite(db, as(c.dono), convite({ unidades: [b.unitId] }))).toEqual({ ok: false, erro: 'nao_encontrada' })
    expect(await criarConvite(db, as(c.dono), convite({ unidades: ['nao-uuid'] }))).toEqual({ ok: false, erro: 'nao_encontrada' })
    expect((await criarConvite(db, as(c.dono), convite({ papel: 'gerente' }))).ok).toBe(true)
    const [inv] = await db.select().from(staffInvites)
    expect(inv).toMatchObject({ papel: 'gerente', unidades: [] })
  })

  it('reenviar: volta a pendente (de erro ou enviado); só o dono; aceito não reenvia', async () => {
    const c = await cenario()
    const r = await criarConvite(db, as(c.dono), convite())
    const id = r.ok ? r.valor.conviteId : ''
    await db.update(staffInvites).set({ status: 'erro', erro: 'falha_temporaria' }).where(eq(staffInvites.id, id))
    expect(await reenviarConvite(db, as(c.gerente), id)).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(await reenviarConvite(db, as(c.dono), id)).toEqual({ ok: true, valor: null })
    const [inv] = await db.select().from(staffInvites)
    expect(inv).toMatchObject({ status: 'pendente', erro: null })
    await db.update(staffInvites).set({ status: 'aceito' }).where(eq(staffInvites.id, id))
    expect(await reenviarConvite(db, as(c.dono), id)).toEqual({ ok: false, erro: 'nao_encontrada' })
    expect((await logs()).map((l) => l.acao)).toEqual(['equipe.convite_criado', 'equipe.convite_reenviado'])
  })
})

describe('membros', () => {
  it('listarEquipe: membros com e-mail e convites em aberto para dono/gerente; atendente não vê', async () => {
    const c = await cenario()
    await db.update(staff).set({ unidadesPermitidas: [c.unitId] }).where(eq(staff.userId, c.atendente))
    await criarConvite(db, as(c.dono), convite())
    const l = await listarEquipe(db, as(c.gerente))
    expect(l.filter((m) => m.tipo === 'membro').map((m) => m.papel).sort()).toEqual(['atendente', 'dono', 'gerente'])
    const at = l.find((m) => m.id === c.atendente)!
    expect(at).toMatchObject({ tipo: 'membro', nome: 'atendente', ativo: true, unidades: [c.unitId], email: expect.stringMatching(/^atendente-.*@teste\.local$/) })
    const inv = l.find((m) => m.tipo === 'convite')!
    expect(inv).toMatchObject({ email: 'nova@teste.local', nome: 'Nova Pessoa', papel: 'atendente', unidades: [], status: 'pendente', ativo: false })
    expect(await listarEquipe(db, as(c.atendente, 'aal1'))).toEqual([])
  })

  it('definirAtivo: dono desativa e reativa; não a si mesmo; gerente não; auditado', async () => {
    const c = await cenario()
    expect(await definirAtivo(db, as(c.dono), c.atendente, false)).toEqual({ ok: true, valor: null })
    const [s] = await db.select().from(staff).where(eq(staff.userId, c.atendente))
    expect(s!.ativo).toBe(false)
    expect(await definirAtivo(db, as(c.dono), c.dono, false)).toEqual({ ok: false, erro: 'a_si_mesmo' })
    expect(await definirAtivo(db, as(c.gerente), c.atendente, true)).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(await definirAtivo(db, as(c.dono), '00000000-0000-0000-0000-000000000000', true)).toEqual({ ok: false, erro: 'nao_encontrada' })
    expect(await definirAtivo(db, as(c.dono), c.atendente, true)).toEqual({ ok: true, valor: null })
    expect((await logs()).map((l) => [l.acao, l.diff])).toEqual([
      ['equipe.ativo_alterado', { de: true, para: false }],
      ['equipe.ativo_alterado', { de: false, para: true }],
    ])
  })
})

describe('worker: processamento do convite', () => {
  it('conviteParaProcessar só devolve pendente; concluirConvite cria o staff e marca enviado', async () => {
    const c = await cenario()
    const r = await criarConvite(db, as(c.dono), convite({ papel: 'gerente', unidades: [c.unitId] }))
    const id = r.ok ? r.valor.conviteId : ''
    const dados = await withRole(db, 'worker_app', (tx) => conviteParaProcessar(tx, id))
    expect(dados).toEqual({ email: 'nova@teste.local', nome: 'Nova Pessoa', papel: 'gerente', unidades: [c.unitId], restaurantId: c.restaurantId })
    const userId = await createAuthUser(sql, 'nova@teste.local')
    await withRole(db, 'worker_app', (tx) => concluirConvite(tx, id, { ok: true, userId }))
    const [s] = await db.select().from(staff).where(eq(staff.userId, userId))
    expect(s).toMatchObject({ restaurantId: c.restaurantId, nome: 'Nova Pessoa', papel: 'gerente', unidadesPermitidas: [c.unitId], ativo: true })
    const [inv] = await db.select().from(staffInvites)
    expect(inv).toMatchObject({ status: 'enviado', userId, erro: null })
    expect(await withRole(db, 'worker_app', (tx) => conviteParaProcessar(tx, id))).toBeNull()
    expect(await withRole(db, 'worker_app', (tx) => conviteParaProcessar(tx, '00000000-0000-0000-0000-000000000000'))).toBeNull()
  })

  it('membro convidado que nunca entrou expõe o conviteId (reenviar); quem já entrou não', async () => {
    const c = await cenario()
    const r = await criarConvite(db, as(c.dono), convite())
    const id = r.ok ? r.valor.conviteId : ''
    const userId = await createAuthUser(sql, 'nova@teste.local')
    await withRole(db, 'worker_app', (tx) => concluirConvite(tx, id, { ok: true, userId }))
    const m = (await listarEquipe(db, as(c.dono))).find((x) => x.id === userId)
    expect(m).toMatchObject({ tipo: 'membro', convitePendente: true, conviteId: id })
    expect((await listarEquipe(db, as(c.dono))).filter((x) => x.tipo === 'convite')).toEqual([])
    expect(await reenviarConvite(db, as(c.dono), id)).toEqual({ ok: true, valor: null })
    await withRole(db, 'worker_app', (tx) => concluirConvite(tx, id, { ok: true, userId }))
    await sql`update auth.users set last_sign_in_at = now() where id = ${userId}`
    // quem já entrou não recebe reenvio (nem por chamada direta da action): o convite `enviado` não volta a pendente
    expect(await reenviarConvite(db, as(c.dono), id)).toEqual({ ok: false, erro: 'nao_encontrada' })
    expect((await db.select({ status: staffInvites.status }).from(staffInvites).where(eq(staffInvites.id, id)))[0]!.status).toBe('enviado')
    const depois = (await listarEquipe(db, as(c.dono))).find((x) => x.id === userId)
    expect(depois).toMatchObject({ convitePendente: false, conviteId: null })
    expect((await listarEquipe(db, as(c.dono))).find((x) => x.id === c.gerente)).toMatchObject({ conviteId: null })
  })

  it('nunca rebaixa o dono; erro fora do formato de código vira erro_desconhecido', async () => {
    const c = await cenario()
    const r1 = await criarConvite(db, as(c.dono), convite())
    const id1 = r1.ok ? r1.valor.conviteId : ''
    await withRole(db, 'worker_app', (tx) => concluirConvite(tx, id1, { ok: true, userId: c.dono }))
    expect((await db.select().from(staff).where(eq(staff.userId, c.dono)))[0]).toMatchObject({ papel: 'dono' })
    expect((await db.select().from(staffInvites).where(eq(staffInvites.id, id1)))[0]).toMatchObject({ status: 'erro', erro: 'ja_membro' })
    const r2 = await criarConvite(db, as(c.dono), convite({ email: 'outra@teste.local' }))
    const id2 = r2.ok ? r2.valor.conviteId : ''
    await withRole(db, 'worker_app', (tx) => concluirConvite(tx, id2, { ok: false, erro: 'User outra@teste.local already registered' }))
    expect((await db.select().from(staffInvites).where(eq(staffInvites.id, id2)))[0]).toMatchObject({ status: 'erro', erro: 'erro_desconhecido' })
  })

  it('erro grava o código; usuário de outro restaurante não é movido (erro outro_restaurante)', async () => {
    const c = await cenario()
    const b = await seedRestaurant(db)
    const donoB = await seedStaff(db, sql, { restaurantId: b.restaurantId, papel: 'dono' })
    const r = await criarConvite(db, as(c.dono), convite())
    const id = r.ok ? r.valor.conviteId : ''
    await withRole(db, 'worker_app', (tx) => concluirConvite(tx, id, { ok: false, erro: 'email_existente' }))
    expect((await db.select().from(staffInvites))[0]).toMatchObject({ status: 'erro', erro: 'email_existente' })
    await db.update(staffInvites).set({ status: 'pendente', erro: null })
    await withRole(db, 'worker_app', (tx) => concluirConvite(tx, id, { ok: true, userId: donoB }))
    expect((await db.select().from(staffInvites))[0]).toMatchObject({ status: 'erro', erro: 'outro_restaurante' })
    const [s] = await db.select().from(staff).where(eq(staff.userId, donoB))
    expect(s).toMatchObject({ restaurantId: b.restaurantId, papel: 'dono' })
  })

  it('restaurantesAtivos lista todos os restaurantes (worker)', async () => {
    const a = await seedRestaurant(db)
    const b = await seedRestaurant(db)
    expect((await withRole(db, 'worker_app', (tx) => restaurantesAtivos(tx))).sort()).toEqual([a.restaurantId, b.restaurantId].sort())
  })
})
