import { sql } from 'drizzle-orm'
import type { Db } from './client.ts'

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

export type JwtClaims = {
  sub: string
  role: 'authenticated'
  aal: 'aal1' | 'aal2'
  [k: string]: unknown
}

/**
 * Executa `fn` como o usuário do painel, sob RLS.
 * Claims vão por parâmetro ($1) — NUNCA via sql.raw (vetor de SQL injection
 * presente no exemplo oficial do Drizzle).
 */
export function withUserContext<T>(db: Db, claims: JwtClaims, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await assumirUsuario(tx, claims)
    return fn(tx)
  })
}

/**
 * Passa a transação corrente para o usuário do painel (claims parametrizadas + `authenticated`) até o fim dela.
 * Para gravar auditoria sob RLS no fim de uma mutação feita como web_app, na mesma transação.
 */
export async function assumirUsuario(tx: Tx, claims: JwtClaims): Promise<void> {
  await tx.execute(
    sql`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true),
               set_config('request.jwt.claim.sub', ${claims.sub}, true)`,
  )
  await tx.execute(sql`set local role authenticated`)
}

const ROLES = { web_app: sql`web_app`, worker_app: sql`worker_app` } as const

/** Só para testes de grants: assume um role de aplicação dentro da transação. */
export function withRole<T>(db: Db, role: keyof typeof ROLES, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role ${ROLES[role]}`)
    return fn(tx)
  })
}
