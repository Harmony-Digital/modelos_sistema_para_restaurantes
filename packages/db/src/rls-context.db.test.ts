import { afterAll, describe, expect, it } from 'vitest'
import { sql as dsql } from 'drizzle-orm'
import { getTestDb } from './test-utils.ts'
import { withUserContext } from './rls.ts'

const { db, sql } = getTestDb()
afterAll(() => sql.end())

const sub = '00000000-0000-0000-0000-000000000001'

describe('withUserContext', () => {
  it('define role e auth.uid() dentro da transação', async () => {
    const rows = await withUserContext(db, { sub, role: 'authenticated', aal: 'aal2' }, (tx) =>
      tx.execute<{ who: string; uid: string; aal: string }>(
        dsql`select current_user as who, auth.uid()::text as uid, auth.jwt()->>'aal' as aal`,
      ),
    )
    expect(rows[0]).toEqual({ who: 'authenticated', uid: sub, aal: 'aal2' })
  })

  it('claims maliciosas são dado, não SQL', async () => {
    const evil = `'); drop table public.units; --`
    const rows = await withUserContext(db, { sub, role: 'authenticated', aal: 'aal1', nome: evil }, (tx) =>
      tx.execute<{ nome: string }>(dsql`select auth.jwt()->>'nome' as nome`),
    )
    expect(rows[0]!.nome).toBe(evil)
    const [t] = await sql`select to_regclass('public.units') as t`
    expect(t!.t).not.toBeNull()
  })

  it('contexto não vaza para fora da transação', async () => {
    await withUserContext(db, { sub, role: 'authenticated', aal: 'aal1' }, async () => undefined)
    const [row] = await sql`select current_user as who, current_setting('request.jwt.claims', true) as c`
    expect(row!.who).toBe('postgres')
    expect(row!.c ?? '').toBe('')
  })
})
