import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql as dsql } from 'drizzle-orm'
import { getTestDb, resetDb, seedRestaurant, seedStaff } from './test-utils.ts'
import { withUserContext, type JwtClaims } from './rls.ts'
import { removerLogo, salvarLogo, salvarRegrasReserva } from './marca.ts'
import { auditLog, restaurants } from './schema/index.ts'
import { REGRAS_RESERVA_PADRAO } from './schema/restaurant.ts'

const { db, sql } = getTestDb()
beforeEach(async () => {
  await resetDb(sql)
  await sql.begin(async (tx) => {
    await tx`select set_config('storage.allow_delete_query', 'true', true)`
    await tx`delete from storage.objects where bucket_id = 'marca'`
  })
})
afterAll(() => sql.end())

const as = (sub: string, aal: 'aal1' | 'aal2' = 'aal2'): JwtClaims => ({ sub, role: 'authenticated', aal })
const negado = { cause: { code: '42501' } }
const SHA = 'a'.repeat(64)

async function cenario() {
  const { restaurantId } = await seedRestaurant(db)
  const dono = await seedStaff(db, sql, { restaurantId, papel: 'dono' })
  const gerente = await seedStaff(db, sql, { restaurantId, papel: 'gerente' })
  const atendente = await seedStaff(db, sql, { restaurantId, papel: 'atendente' })
  return { restaurantId, dono, gerente, atendente }
}
const linha = async (id: string) => (await db.select().from(restaurants).where(eq(restaurants.id, id)))[0]!

describe('regras da reserva', () => {
  it('nasce com o texto padrão', async () => {
    const c = await cenario()
    expect((await linha(c.restaurantId)).regrasReserva).toBe(REGRAS_RESERVA_PADRAO)
    expect(REGRAS_RESERVA_PADRAO).toContain('15 minutos')
  })

  it('dono e gerente salvam (com trim e auditoria); atendente não; vazio ou acima de 600 ⇒ valor_invalido', async () => {
    const c = await cenario()
    expect(await salvarRegrasReserva(db, as(c.gerente), c.restaurantId, '  Tolerância de 10 minutos.  ')).toEqual({ ok: true, valor: null })
    expect((await linha(c.restaurantId)).regrasReserva).toBe('Tolerância de 10 minutos.')
    expect(await salvarRegrasReserva(db, as(c.dono), c.restaurantId, 'x'.repeat(600))).toEqual({ ok: true, valor: null })
    expect(await salvarRegrasReserva(db, as(c.dono), c.restaurantId, 'x'.repeat(601))).toEqual({ ok: false, erro: 'valor_invalido' })
    expect(await salvarRegrasReserva(db, as(c.dono), c.restaurantId, '   ')).toEqual({ ok: false, erro: 'valor_invalido' })
    expect(await salvarRegrasReserva(db, as(c.atendente), c.restaurantId, 'oi')).toEqual({ ok: false, erro: 'sem_permissao' })
    expect((await linha(c.restaurantId)).regrasReserva).toBe('x'.repeat(600))
    const logs = await db.select().from(auditLog).where(eq(auditLog.entidadeId, c.restaurantId))
    expect(logs.map((l) => l.acao)).toEqual(['restaurante.regras_reserva', 'restaurante.regras_reserva'])
  })

  it('outro restaurante ⇒ nao_encontrada', async () => {
    const c = await cenario()
    const b = await seedRestaurant(db)
    expect(await salvarRegrasReserva(db, as(c.dono), b.restaurantId, 'oi')).toEqual({ ok: false, erro: 'nao_encontrada' })
  })

  it('gerente atualiza só regras e logo; qualquer outra coluna do restaurante é recusada no banco', async () => {
    const c = await cenario()
    for (const set of [{ nome: 'Outro' }, { modoDemonstracao: true }, { cotacaoUsdBrl: '6' }]) {
      await expect(withUserContext(db, as(c.gerente), (tx) => tx.update(restaurants).set(set)), JSON.stringify(set)).rejects.toMatchObject(negado)
    }
    const ok = await withUserContext(db, as(c.gerente), (tx) => tx.update(restaurants).set({ regrasReserva: 'Novo' }).returning())
    expect(ok).toHaveLength(1)
    // atendente não atualiza nada (sem policy de update)
    expect(await withUserContext(db, as(c.atendente, 'aal1'), (tx) => tx.update(restaurants).set({ regrasReserva: 'X' }).returning())).toHaveLength(0)
    // dono segue atualizando o restaurante
    expect(await withUserContext(db, as(c.dono), (tx) => tx.update(restaurants).set({ nome: 'Novo nome' }).returning())).toHaveLength(1)
  })
})

describe('logo', () => {
  it('salvar devolve a anterior (para apagar o objeto depois do commit); remover zera; auditado', async () => {
    const c = await cenario()
    const p1 = `${c.restaurantId}/logo-${SHA}.png`
    const p2 = `${c.restaurantId}/logo-${'b'.repeat(64)}.webp`
    expect(await salvarLogo(db, as(c.dono), c.restaurantId, p1)).toEqual({ ok: true, valor: { anterior: null } })
    expect(await salvarLogo(db, as(c.gerente), c.restaurantId, p2)).toEqual({ ok: true, valor: { anterior: p1 } })
    expect((await linha(c.restaurantId)).logoPath).toBe(p2)
    expect(await removerLogo(db, as(c.gerente), c.restaurantId)).toEqual({ ok: true, valor: { anterior: p2 } })
    expect((await linha(c.restaurantId)).logoPath).toBeNull()
    expect(await removerLogo(db, as(c.dono), c.restaurantId)).toEqual({ ok: true, valor: { anterior: null } })
    const logs = await db.select().from(auditLog).where(eq(auditLog.entidadeId, c.restaurantId))
    expect(logs.map((l) => l.acao)).toEqual(['restaurante.logo', 'restaurante.logo', 'restaurante.logo'])
  })

  it('caminho fora do padrão, de outro restaurante ou SVG ⇒ valor_invalido; atendente ⇒ sem_permissao', async () => {
    const c = await cenario()
    const b = await seedRestaurant(db)
    for (const p of [
      `${b.restaurantId}/logo-${SHA}.png`, `${c.restaurantId}/logo-${SHA}.svg`, `${c.restaurantId}/../logo-${SHA}.png`,
      `${c.restaurantId}/logo-xyz.png`, `marca/${c.restaurantId}/logo-${SHA}.png`, '',
    ]) {
      expect(await salvarLogo(db, as(c.dono), c.restaurantId, p), p).toEqual({ ok: false, erro: 'valor_invalido' })
    }
    expect(await salvarLogo(db, as(c.atendente), c.restaurantId, `${c.restaurantId}/logo-${SHA}.png`)).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(await removerLogo(db, as(c.atendente), c.restaurantId)).toEqual({ ok: false, erro: 'sem_permissao' })
    expect((await linha(c.restaurantId)).logoPath).toBeNull()
    // o check do banco também barra caminho de outro restaurante
    await expect(db.update(restaurants).set({ logoPath: `${b.restaurantId}/logo-${SHA}.png` }).where(eq(restaurants.id, c.restaurantId)))
      .rejects.toMatchObject({ cause: { code: '23514' } })
  })
})

describe('Storage: bucket marca', () => {
  const put = (claims: JwtClaims, name: string) =>
    withUserContext(db, claims, (tx) => tx.execute(dsql`insert into storage.objects (bucket_id, name) values ('marca', ${name})`))
  const apagar = (claims: JwtClaims, name: string) =>
    withUserContext(db, claims, async (tx) => {
      await tx.execute(dsql`select set_config('storage.allow_delete_query', 'true', true)`)
      return tx.execute(dsql`delete from storage.objects where bucket_id = 'marca' and name = ${name} returning id`)
    })

  it('bucket público, até 1 MB, só PNG/JPEG/WebP (sem SVG)', async () => {
    const [b] = await sql<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }[]>`
      select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'marca'`
    expect(b!.public).toBe(true)
    expect(Number(b!.file_size_limit)).toBe(1024 * 1024)
    expect([...b!.allowed_mime_types].sort()).toEqual(['image/jpeg', 'image/png', 'image/webp'])
  })

  it('dono e gerente gravam e apagam na pasta do restaurante; atendente não; outra pasta não; sem MFA não', async () => {
    const c = await cenario()
    const b = await seedRestaurant(db)
    await put(as(c.dono), `${c.restaurantId}/logo-1.png`)
    await put(as(c.gerente), `${c.restaurantId}/logo-2.png`)
    await expect(put(as(c.atendente, 'aal1'), `${c.restaurantId}/logo-3.png`)).rejects.toMatchObject(negado)
    await expect(put(as(c.atendente), `${c.restaurantId}/logo-3.png`)).rejects.toMatchObject(negado)
    await expect(put(as(c.dono), `${b.restaurantId}/logo-4.png`)).rejects.toMatchObject(negado)
    await expect(put(as(c.dono, 'aal1'), `${c.restaurantId}/logo-5.png`)).rejects.toMatchObject(negado)
    expect(await apagar(as(c.atendente), `${c.restaurantId}/logo-1.png`)).toHaveLength(0)
    expect(await apagar(as(c.gerente), `${c.restaurantId}/logo-1.png`)).toHaveLength(1)
    const donoB = await seedStaff(db, sql, { restaurantId: b.restaurantId, papel: 'dono' })
    expect(await apagar(as(donoB), `${c.restaurantId}/logo-2.png`)).toHaveLength(0)
    const upd = await withUserContext(db, as(c.dono), (tx) =>
      tx.execute(dsql`update storage.objects set name = ${`${c.restaurantId}/x.png`} where bucket_id = 'marca' returning id`))
    expect(upd).toHaveLength(0)
  })
})
