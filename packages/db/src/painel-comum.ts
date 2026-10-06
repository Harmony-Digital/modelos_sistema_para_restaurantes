import { sql } from 'drizzle-orm'
import type { JwtClaims, Tx } from './rls.ts'
import { auditLog } from './schema/ops.ts'

export type ErroPainel = 'sem_permissao' | 'nao_encontrada' | 'nome_duplicado'
export type ResultadoPainel<T = null> = { ok: true; valor: T } | { ok: false; erro: ErroPainel }

export const ok = <T>(valor: T): ResultadoPainel<T> => ({ ok: true, valor })
export const falha = <T = never>(erro: ErroPainel): ResultadoPainel<T> => ({ ok: false, erro })

// o Drizzle 0.45 embrulha o erro do driver em `cause`
function erroPg(err: unknown): { code?: string; constraint_name?: string } {
  const c = (err as { cause?: unknown } | null)?.cause ?? err
  return (typeof c === 'object' && c !== null ? c : {}) as { code?: string; constraint_name?: string }
}

/** Recusa de RLS/grant (42501) vira `sem_permissao`; violação de única listada vira o erro indicado. */
export async function semPermissaoVira<R extends { ok: boolean }>(
  fn: () => Promise<R>,
  unicas: Record<string, ErroPainel> = {},
): Promise<R | { ok: false; erro: ErroPainel }> {
  try {
    return await fn()
  } catch (err) {
    const e = erroPg(err)
    if (e.code === '42501') return { ok: false, erro: 'sem_permissao' }
    if (e.code === '23505' && e.constraint_name && unicas[e.constraint_name]) return { ok: false, erro: unicas[e.constraint_name]! }
    throw err
  }
}

/** Papel do usuário da transação (RLS ativa). Necessário porque DELETE que a policy filtra não dá erro. */
export async function exigirPapel(tx: Tx, papeis: readonly ('dono' | 'gerente' | 'atendente')[]): Promise<boolean> {
  const rows = await tx.execute<{ papel: string | null }>(sql`select app.my_role()::text as papel`)
  const papel = rows[0]?.papel ?? null
  return papel !== null && (papeis as readonly string[]).includes(papel)
}

export async function registrarAuditoria(
  tx: Tx,
  claims: JwtClaims,
  a: { restaurantId: string; acao: string; entidade: string; entidadeId: string | null; diff?: unknown },
): Promise<void> {
  await tx.insert(auditLog).values({
    restaurantId: a.restaurantId,
    atorId: claims.sub,
    atorTipo: 'staff',
    acao: a.acao,
    entidade: a.entidade,
    entidadeId: a.entidadeId,
    diff: a.diff ?? null,
  })
}
