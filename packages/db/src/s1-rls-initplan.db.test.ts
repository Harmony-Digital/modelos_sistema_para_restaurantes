import { afterAll, describe, expect, it } from 'vitest'
import { getTestDb } from './test-utils.ts'

const { sql } = getTestDb()
afterAll(() => sql.end())

const TABELAS = ['units', 'unit_hours', 'unit_hour_exceptions', 'knowledge_facts', 'knowledge_gaps']

describe('permissão por unidade em initplan', () => {
  it('nenhuma policy chama can_access_unit por linha; todas usam as funções de initplan', async () => {
    const rows = await sql<{ t: string; name: string; expr: string }[]>`
      select tablename as t, policyname as name, coalesce(qual, '') || ' ' || coalesce(with_check, '') as expr
        from pg_policies where schemaname = 'public' and tablename = any(${TABELAS})
         and policyname in ('staff_read', 'gestao_write', 'gestao_update')`
    expect(rows.length).toBe(10)
    for (const r of rows) {
      expect(r.expr, `${r.t}.${r.name}`).not.toContain('can_access_unit')
      expect(r.expr, `${r.t}.${r.name}`).toContain('acesso_todas_unidades')
      expect(r.expr, `${r.t}.${r.name}`).toContain('minhas_unidades')
    }
  })

  it('índices novos existem', async () => {
    const rows = await sql<{ indexname: string }[]>`
      select indexname from pg_indexes where indexname in
        ('knowledge_facts_unit_idx', 'knowledge_gaps_unit_idx', 'ai_runs_restaurant_created_idx')`
    expect(rows.map((r) => r.indexname).sort()).toEqual(['ai_runs_restaurant_created_idx', 'knowledge_facts_unit_idx', 'knowledge_gaps_unit_idx'])
  })

  it('conversa tem relógio simulado opcional', async () => {
    const [c] = await sql<{ is_nullable: string; data_type: string }[]>`
      select is_nullable, data_type from information_schema.columns
       where table_name = 'conversations' and column_name = 'relogio_offset_segundos'`
    expect(c).toEqual({ is_nullable: 'YES', data_type: 'integer' })
  })
})
